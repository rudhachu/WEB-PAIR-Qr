const express = require('express');
const fs = require('fs-extra');
const { exec } = require("child_process");
const pino = require("pino");
const { Boom } = require("@hapi/boom");
const { upload } = require('./mega');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    DisconnectReason
} = require("@whiskeysockets/baileys");

const router = express.Router();

const MESSAGE = process.env.MESSAGE || `
*RUDHRA BOT SESSION ID*

> ʀᴜᴅʜʀᴀ-ʙᴏᴛ
`;

// Ensure the directory is empty when the app starts
const AUTH_DIR = './auth_info_baileys';
if (fs.existsSync(AUTH_DIR)) {
    fs.emptyDirSync(AUTH_DIR);
}

// Helper: Generate Random Mega ID
function randomMegaId(length = 6, numberLength = 4) {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const randomChars = Array.from({ length }, () => 
        characters.charAt(Math.floor(Math.random() * characters.length))
    ).join('');
    const randomNumber = Math.floor(Math.random() * Math.pow(10, numberLength));
    return `${randomChars}${randomNumber}`;
}

// Helper: Restart Application
function restartService() {
    console.log("Restarting service...");
    exec('pm2 restart rudhra-id');
}

// Core Function: Handle WhatsApp Pairing and Session Management
async function getPair(number, res) {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    try {
        const session = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
            },
            printQRInTerminal: false,
            logger: pino({ level: "fatal" }),
            browser: Browsers.macOS("Safari"),
        });

        // If the session is not registered, generate and return a pairing code
        if (!session.authState.creds.registered) {
            await delay(1500);
            number = number.replace(/[^0-9]/g, '');
            const code = await session.requestPairingCode(number);
            if (!res.headersSent) res.send({ code });
        }

        session.ev.on('creds.update', saveCreds);

        // Handle connection updates
        session.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
            if (connection === "open") {
                await handleSuccessfulConnection(session);
            } else if (connection === "close") {
                await handleConnectionClose(lastDisconnect, res);
            }
        });
    } catch (err) {
        console.error("Error in getPair function: ", err);
        restartService();
        if (!res.headersSent) res.send({ code: "Try Again Later" });
    }
}

// Handle a successful connection
async function handleSuccessfulConnection(session) {
    try {
        await delay(10000);

        if (fs.existsSync(`${AUTH_DIR}/creds.json`)) {
            const megaURL = await upload(fs.createReadStream(`${AUTH_DIR}/creds.json`), `${randomMegaId()}.json`);
            const scanId = megaURL.replace('https://mega.nz/file/', '');

            const user = session.user.id;
            const msg = await session.sendMessage(user, { text: scanId });
            await session.sendMessage(user, { text: MESSAGE }, { quoted: msg });

            await delay(1000);
            fs.emptyDirSync(AUTH_DIR);
        }
    } catch (err) {
        console.error("Error during upload or message send: ", err);
    }
}

// Handle connection closure and errors
async function handleConnectionClose(lastDisconnect, res) {
    const reason = new Boom(lastDisconnect?.error)?.output.statusCode;

    switch (reason) {
        case DisconnectReason.connectionClosed:
            console.log("Connection closed!");
            break;
        case DisconnectReason.connectionLost:
            console.log("Connection lost from server!");
            break;
        case DisconnectReason.restartRequired:
            console.log("Restart required, restarting...");
            restartService();
            break;
        case DisconnectReason.timedOut:
            console.log("Connection timed out!");
            break;
        default:
            console.log("Unexpected disconnect reason:", reason);
            restartService();
            break;
    }
}

// Route: Handle WhatsApp Pairing
router.get('/', async (req, res) => {
    const number = req.query.number;
    if (!number) return res.status(400).send({ error: "Number is required" });

    await getPair(number, res);
});

module.exports = router;
