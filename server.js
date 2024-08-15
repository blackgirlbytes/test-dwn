import express from 'express';
import { Web5 } from '@web5/api';
import fs from 'fs/promises';
import path from 'path';

const app = express();
const port = 5001;

// File to store the DID
const DID_FILE = path.join(process.cwd(), 'did.json');

// Global variables to store the DID and Web5 instance
let did;
let web5;

// Protocol Definition
const protocolDefinition = {
    protocol: 'https://vc-to-dwn.tbddev.org/vc-protocol',
    published: true,
    types: {
        credential: {
            dataFormats: ['application/vc+jwt']
        },
        issuer: {
            dataFormats: ['application/json']
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
                    can: ['create', 'delete']
                }
            ],
        }
    }
};

// does protocol exist already? 
const queryProtocol = async (web5, did = null) => {
    const message = {
        filter: {
            protocol: protocolDefinition.protocol,
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
            definition: protocolDefinition,
        },
    });
    console.log("Protocol installed locally", protocol, status);
    return { protocol, status };
};


const configureProtocol = async (web5, did) => {
    console.log('Configuring protocol...');

    const { protocols: localProtocol, status: localStatus } = await queryProtocol(web5);
    console.log('Local protocol:', localStatus.code === 200 ? 'Found' : 'Not found');
  // if protocol is not found on DWN then install it on local DWN and remote DWN.
    if (localStatus.code !== 200 || localProtocol.length === 0) {
        const { protocol } = await installProtocol(web5);
        const sendStatus = await protocol.send(did);
        console.log("Installing protocol", sendStatus);
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
            password: 'fakepassword',
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
            password: 'fakepassword',
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


        // Save the new DID to file
        await fs.writeFile(DID_FILE, JSON.stringify({ did }), 'utf8');
        console.log('New DID created and saved:', did);
    }
    console.log(did, web5)
    return { web5, did };
}


async function initializeServer() {
    try {
        const { web5: loadedWeb5, did: loadedDid } = await loadOrCreateDID();
        web5 = loadedWeb5;
        did = loadedDid;
        console.log('NEXT')
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
app.get('/vc-protocol', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(protocolDefinition, null, 2));
});

// Start the server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});