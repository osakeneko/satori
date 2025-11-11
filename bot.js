// Baileys WhatsApp Bot - 100% Free Connection
// No Twilio needed!

const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, downloadMediaMessage } = require('@whiskeysockets/baileys')
const axios = require('axios')
const express = require('express')
const fs = require('fs')
const path = require('path')
const qrcode = require("qrcode-terminal"); // added for QR display
let latestQR = null; // stores latest QR for web viewing


// Configuration
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || 'http://localhost:5678/webhook/whatsapp-webhook'
const PORT = process.env.PORT || 3000

// Express server for sending messages back
const app = express()
app.use(express.json())

let sock // WhatsApp socket

// Initialize WhatsApp connection
async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys')

    sock = makeWASocket({
        auth: state,
        browser: ['Satori Bot', 'Chrome', '1.0.0'],
syncFullHistory: false,
markOnlineOnConnect: true

        browser: ['Satori Bot', 'Chrome', '1.0.0'],
        syncFullHistory: false,
        markOnlineOnConnect: true
    })

    // Save credentials
    sock.ev.on('creds.update', saveCreds)

    // Handle QR updates
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            latestQR = qr;
            console.log("📱 New QR Code generated! Visit /qr to scan.");
            qrcode.generate(qr, { small: true });
        }
    });


    // Connection updates
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut
            console.log('Connection closed. Reconnecting:', shouldReconnect)

            if (shouldReconnect) {
                connectToWhatsApp()
            }
        } else if (connection === 'open') {
            console.log('✅ Satori Bot connected to WhatsApp!')
        }
    })

    // Handle incoming messages
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return

        for (const msg of messages) {
            await handleMessage(msg)
        }
    })
}

// Handle individual message
async function handleMessage(msg) {
    try {
        if (!msg.message) return // Ignore status updates, etc.

        const isGroup = msg.key.remoteJid.includes('@g.us')
        const sender = msg.key.remoteJid

        // Extract message text
        let text = ''
        if (msg.message.conversation) {
            text = msg.message.conversation
        } else if (msg.message.extendedTextMessage) {
            text = msg.message.extendedTextMessage.text
        } else if (msg.message.imageMessage) {
            text = msg.message.imageMessage.caption || ''
        } else if (msg.message.documentMessage) {
            text = msg.message.documentMessage.caption || ''
        }

        // Check if bot should respond
        const shouldRespond = !isGroup ||
            text.toLowerCase().includes('!satori') ||
            text.toLowerCase().includes('@satori')

        if (!shouldRespond) return

        // Check for media
        const hasMedia = !!(msg.message.imageMessage ||
            msg.message.documentMessage ||
            msg.message.videoMessage)

        let mediaData = null
        if (hasMedia) {
            try {
                // Download media
                const buffer = await downloadMediaMessage(msg, 'buffer', {})
                mediaData = {
                    buffer: buffer.toString('base64'),
                    mimetype: msg.message.imageMessage?.mimetype ||
                        msg.message.documentMessage?.mimetype ||
                        'application/octet-stream'
                }
            } catch (err) {
                console.error('Error downloading media:', err)
            }
        }

        // Get group name if applicable
        let groupName = 'Private Chat'
        if (isGroup) {
            try {
                const groupMetadata = await sock.groupMetadata(sender)
                groupName = groupMetadata.subject || sender.split('@')[0]
            } catch {
                groupName = sender.split('@')[0]
            }
        }

        // Send to n8n webhook
        const payload = {
            from: sender,
            body: text,
            isGroup: isGroup,
            groupName: groupName,
            hasMedia: hasMedia,
            media: mediaData,
            timestamp: new Date().toISOString(),
            messageId: msg.key.id
        }

        console.log(`📨 Received message: "${text.substring(0, 50)}..." from ${groupName}`)

        await axios.post(N8N_WEBHOOK_URL, payload, {
            timeout: 30000
        })

    } catch (error) {
        console.error('Error handling message:', error)
    }
}

// Express endpoint to send messages
app.post('/send-message', async (req, res) => {
    try {
        const { to, message } = req.body

        if (!to || !message) {
            return res.status(400).json({ error: 'Missing to or message' })
        }

        await sock.sendMessage(to, { text: message })

        console.log(`✉️ Sent message to ${to}`)
        res.json({ success: true, to, message })

    } catch (error) {
        console.error('Error sending message:', error)
        res.status(500).json({ error: error.message })
    }
})

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'online',
        bot: 'Satori Komeiji',
        connected: !!sock?.user
    })
})

app.get('/qr', (req, res) => {
    if (!latestQR) return res.send('No QR available yet. Wait for generation.');
    res.send(`<img src="https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(latestQR)}&size=300x300">`);
});

// Start server

app.listen(PORT, () => {
    console.log(`🚀 Satori Bot API running on port ${PORT}`)
})

// Connect to WhatsApp
connectToWhatsApp()

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n👋 Shutting down Satori Bot...')
    if (sock) {
        await sock.logout()
    }
    process.exit(0)
})
