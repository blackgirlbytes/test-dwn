import express from 'express';
import { Web5 } from '@web5/api';
import fs from 'fs/promises';
import path from 'path';

const app = express();
const port = 5001;

// File to store and persist customer DID
const DID_FILE = path.join(process.cwd(), 'did.json');

let did;
let web5;

// Protocol Definition
const vcProtocolDefinition = {
    protocol: 'https://vc-to-dwn.tbddev.org/vc-protocol',
    published: true,
    types: {
        credential: {
            schema: "https://vc-to-dwn.tbddev.org/vc-protocol/schema/credential",
            dataFormats: ['application/vc+jwt']
        },
        issuer: {
            schema: "https://vc-to-dwn.tbddev.org/vc-protocol/schema/issuer",
            dataFormats: ['text/plain']
        }
    },
    structure: {
        issuer: {
            $role: true,
        },
        credential: {
            $actions: [ 
                {
                    who: 'anyone',
                    can: ['read']
                },
                {
                    role: 'issuer', 
                    can: ['create']
                },
                {
                    who: 'author',
                    of: 'credential',
                    can: ['create','delete', 'update']
                }, 
            ],
        }
    }
};

// does protocol exist already? 
const queryProtocol = async (web5, did = null) => {
    const message = {
        filter: {
            protocol: vcProtocolDefinition.protocol,
        },
    };

    return did
        ? await web5.dwn.protocols.query({ from: did, message })
        : await web5.dwn.protocols.query({ message });
};

// install protocol
const installProtocol = async (web5) => {
    const { protocol, status } = await web5.dwn.protocols.configure({
        message: {
            definition: vcProtocolDefinition,
        },
    });
    console.log("Protocol installed locally", status);
    return { protocol, status };
};


const configureProtocol = async (web5, did) => {
    console.log('Configuring protocol...');

    const { protocols: localProtocol, status: localStatus } = await queryProtocol(web5);
    console.log('Local protocol:', localStatus.code === 202 ? 'Found' : 'Not found');
  // if protocol is not found on DWN then install it on local DWN and remote DWN.
    if (localStatus.code !== 202 || localProtocol.length === 0) {
        const { protocol } = await installProtocol(web5);
        const sendStatus = await protocol.send(did);
        console.log("Installing protocol on remote DWN", sendStatus);
    } else {
        console.log("Protocol already installed");
    }
};

async function loadOrCreateDID() {
    try {
        const data = await fs.readFile(DID_FILE, 'utf8');
        const savedData = JSON.parse(data);
        did = savedData.did;
        console.log('Loaded existing DID:', did);

        // Ensure to connect using the existing DID
        const { web5: existingWeb5 } = await Web5.connect({
            connectedDid: did,
            password: 'placeholder-password',
            didCreateOptions: {
                dwnEndpoints: ['https://dwn.gcda.xyz'],
            },
            registration: {
                onSuccess: () => {
                    console.log('Customer registered successfully');
                },
                onFailure: (error) => {
                    console.error('Customer registration failed', error);
                },
            },
        });
        web5 = existingWeb5;

    } catch (error) {
        console.log('Creating new DID...');
        const { web5: newWeb5, did: newDID } = await Web5.connect({
            password: 'placeholder-password',
            didCreateOptions: {
                dwnEndpoints: ['https://dwn.gcda.xyz'],
            },
            registration: {
                onSuccess: () => {
                    console.log('Customer registered successfully');
                },
                onFailure: (error) => {
                    console.error('Customer registration failed', error);
                },
            },
        });
        web5 = newWeb5;
        did = newDID;


        // Store the new DID to file to persist DID
        await fs.writeFile(DID_FILE, JSON.stringify({ did }), 'utf8');
        console.log('New DID created and saved:', did);
    }
    return { web5, did };
}

// Route to authorize an issuer to store a credential in the Customer's DWN
app.get('/authorize', async (req, res) => {
    const { issuerDid } = req.query;

    if (!issuerDid) {
        return res.status(400).json({ error: 'Issuer DID is required as a query parameter' });
    }
    console.log('This issuerDidURI requesting authorization', issuerDid);

    try {
        // Has a role record already been sent to issuer?
        const { records, status: foundStatus } = await web5.dwn.records.query({
            message: {
                filter: {
                    recipient: issuerDid,
                },
            },
        });

        // If role record already has been sent to issuer, then send message to issuer that they already have authorization
        if (records.length > 0) {
            return res.json({
                message: "You already have authorization to store a credential in the Customer's DWN",
                status: foundStatus.code
            });
        }

        // If no issuer role records found, create a new role record 
        const { record, status } = await web5.dwn.records.create({
            message: {
                dataFormat: 'text/plain',
                protocol: vcProtocolDefinition.protocol,
                protocolPath: 'issuer',
                schema: vcProtocolDefinition.types.issuer.schema,
                recipient: issuerDid,
            },
        });
   
        const { status: resultsToCustomerStatus } = await record.send(did);

        console.log({
            message: `Granted ${issuerDid} authorization to store a credential in the Customer's DWN`,
            status: status.code,
            customer: resultsToCustomerStatus,
        });

        res.json({
            message: "You've been granted authorization to store a credential in the Customer's DWN",
            status: status.code,
            customer: resultsToCustomerStatus,
        });
    } catch (error) {
        console.error('Error in authorization:', error);
        res.status(500).json({ error: 'Failed to authorize issuer' });
    }
});

// Route to serve the pretty-printed protocol definition
app.get('/vc-protocol', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(vcProtocolDefinition, null, 2));
});


async function initializeServer() {
    try {
        const { web5: loadedWeb5, did: loadedDid } = await loadOrCreateDID();
        web5 = loadedWeb5;
        did = loadedDid;
        await configureProtocol(web5, did);
        console.log('Server initialization complete');

    } catch (error) {
        console.error('Error initializing server:', error);
        process.exit(1);
    }
}

// Initialize server on startup
initializeServer();

// Middleware to parse JSON bodies
app.use(express.json());

// Route to serve the pretty-printed protocol definition

// Start the server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});