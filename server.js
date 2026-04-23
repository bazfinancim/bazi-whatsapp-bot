const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys')
const { Boom } = require('@hapi/boom')
const express = require('express')
const axios = require('axios')
const fs = require('fs')

const app = express()
app.use(express.json())

const N8N_WEBHOOK = process.env.N8N_WEBHOOK || 'https://n8n-service-dwl2.onrender.com/webhook/bazi054'
const PORT = process.env.PORT || 3000

let sock = null
let qrCode = null

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth_info')
  
  sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
    browser: ['Bazi Bot', 'Chrome', '1.0']
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update
    
    if (qr) {
      qrCode = qr
      console.log('QR Code ready — visit /qr to see it')
    }
    
    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut
      console.log('Connection closed, reconnecting:', shouldReconnect)
      if (shouldReconnect) {
        setTimeout(connectToWhatsApp, 3000)
      }
    } else if (connection === 'open') {
      console.log('✅ WhatsApp connected!')
      qrCode = null
    }
  })

  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      if (msg.key.fromMe) continue
      if (!msg.message) continue
      
      const from = msg.key.remoteJid
      const text = msg.message?.conversation || 
                   msg.message?.extendedTextMessage?.text || 
                   msg.message?.imageMessage?.caption || ''
      
      if (!text) continue
      
      console.log(`📨 From ${from}: ${text}`)
      
      try {
        const response = await axios.post(N8N_WEBHOOK, {
          from,
          text,
          messageId: msg.key.id,
          timestamp: msg.messageTimestamp
        }, { timeout: 30000 })
        
        const reply = response.data?.reply || response.data?.text || response.data
        if (reply && typeof reply === 'string') {
          await sock.sendMessage(from, { text: reply })
        }
      } catch (err) {
        console.error('Webhook error:', err.message)
      }
    }
  })
}

// API endpoints
app.get('/health', (req, res) => res.json({ status: 'ok', connected: sock?.user ? true : false }))

app.get('/qr', (req, res) => {
  if (!qrCode) return res.json({ status: 'already connected or no QR yet' })
  // Return QR as text for scanning
  res.json({ qr: qrCode })
})

app.post('/send', async (req, res) => {
  const { to, message } = req.body
  if (!sock) return res.status(500).json({ error: 'Not connected' })
  try {
    const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`
    await sock.sendMessage(jid, { text: message })
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.listen(PORT, () => {
  console.log(`🚀 Baileys server running on port ${PORT}`)
  connectToWhatsApp()
})
