const { exec } = require("child_process");
const { upload } = require('./mega');
const express = require('express');
const pino = require("pino");
const { toBuffer } = require("qrcode");
const path = require('path');
const fs = require("fs-extra");
const { Boom } = require("@hapi/boom");

let router = express.Router();

// Default message for the bot
const MESSAGE = process.env.MESSAGE || `
*RUDHRA BOT SESSION ID*

> ʀᴜᴅʜʀᴀ-ʙᴏᴛ
`;

// Clear the auth_info_baileys directory if it exists
if (fs.existsSync('./auth_info_baileys')) {
    fs.emptyDirSync(path.join(__dirname, '/auth_info_baileys'));
}

// Route to handle QR code generation and session setup
router.get('/', async (req, res) => {
    const { 
        default: makeWASocket, 
        useMultiFileAuthState, 
        Browsers, 
        delay, 
        DisconnectReason, 
        makeInMemoryStore 
    } = require("@whiskeysockets/baileys");

    const store = makeInMemoryStore({ logger: pino().child({ level: 'silent', stream: 'store' }) });

    // Function to generate and handle QR code for WhatsApp authentication
    async function Getqr() {
        const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, '/auth_info_baileys'));

        try {
            let session = makeWASocket({ 
                printQRInTerminal: false,
                logger: pino({ level: "silent" }),
                browser: Browsers.macOS("Desktop"),
                auth: state
            });

            session.ev.on("connection.update", async (s) => {
                const { connection, lastDisconnect, qr } = s;

                // Handle QR code generation and response
                if (qr && !res.headersSent) {
                    res.setHeader('Content-Type', 'image/png');
                    try {
                        const qrBuffer = await toBuffer(qr); // Convert QR to buffer
                        res.end(qrBuffer); // Send the buffer as the response
                        return;
                    } catch (error) {
                        console.error("Error generating QR Code buffer:", error);
                        return;
                    }
                }

                // Handle successful connection
                if (connection === "open") {
                    await delay(3000);
                    let user = session.user.id;

                    // Generate random session ID and upload credentials
                    function randomMegaId(length = 6, numberLength = 4) {
                        const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
                        let result = '';
                        for (let i = 0; i < length; i++) {
                            result += characters.charAt(Math.floor(Math.random() * characters.length));
                        }
                        const number = Math.floor(Math.random() * Math.pow(10, numberLength));
                        return `${result}${number}`;
                    }

                    const authPath = './auth_info_baileys/';
                    const megaUrl = await upload(fs.createReadStream(path.join(authPath, 'creds.json')), `${randomMegaId()}.json`);
                    const scanId = megaUrl.replace('https://mega.nz/file/', '');

                    console.log(`
====================  SESSION ID  ==========================
SESSION-ID ==> ${scanId}
-------------------   SESSION CLOSED   ---------------------
`);

                    // Send session ID and message
                    let msgsss = await session.sendMessage(user, { text: scanId });
                    await session.sendMessage(user, { text: MESSAGE }, { quoted: msgsss });

                    await delay(1000);
                    try {
                        await fs.emptyDirSync(path.join(__dirname, '/auth_info_baileys'));
                    } catch (e) {
                        console.error("Error clearing auth directory:", e);
                    }
                }

                // Handle credential updates
                session.ev.on('creds.update', saveCreds);

                // Handle connection close reasons
                if (connection === "close") {
                    let reason = new Boom(lastDisconnect?.error)?.output.statusCode;

                    switch (reason) {
                        case DisconnectReason.connectionClosed:
                            console.log("Connection closed!");
                            break;
                        case DisconnectReason.connectionLost:
                            console.log("Connection Lost from Server!");
                            break;
                        case DisconnectReason.restartRequired:
                            console.log("Restart Required, Restarting...");
                            Getqr().catch(err => console.log(err));
                            break;
                        case DisconnectReason.timedOut:
                            console.log("Connection TimedOut!");
                            break;
                        default:
                            console.log('Connection closed with bot. Please run again.');
                            console.log(reason);
                            await delay(5000);
                            exec('pm2 restart rudhra-id');
                            process.exit(0);
                    }
                }
            });
        } catch (err) {
            console.error("Error in Getqr:", err);
            exec('pm2 restart rudhra-id');
            await fs.emptyDirSync(path.join(__dirname, '/auth_info_baileys'));
        }
    }

    // Start the QR generation process
    Getqr().catch(async (err) => {
        console.error("Error in QR process:", err);
        await fs.emptyDirSync(path.join(__dirname, '/auth_info_baileys'));
        exec('pm2 restart rudhra-id');
    });

    return await Getqr();
});

module.exports = router;
