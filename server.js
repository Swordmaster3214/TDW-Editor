// Simple dev server for tdw-editor. No npm required -- just Node.js built-ins.
// Serves static files and proxies TDW's sounds.json + audio files to
// sidestep CORS.
//
// Usage: node server.js
// Then open: http://localhost:3000/

import http     from 'http'
import https    from 'https'
import fs       from 'fs'
import path     from 'path'
import { fileURLToPath } from 'url'

const PORT    = 3000
const ROOT    = path.dirname(fileURLToPath(import.meta.url))

const SOUNDS_UPSTREAM = 'https://thirtydollar.website/sounds.json?v=2'
const AUDIO_BASE      = 'https://thirtydollar.website/sounds/'

const MIME = {
    '.html': 'text/html',
    '.js':   'text/javascript',
    '.json': 'application/json',
    '.css':  'text/css',
    '.png':  'image/png',
    '.svg':  'image/svg+xml',
    '.wav':  'audio/wav',
    '.mp3':  'audio/mpeg',
    '.ogg':  'audio/ogg',
}

const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`)

    // Proxy /sounds.json to TDW so the browser never makes a cross-origin request
    if (url.pathname === '/sounds.json') {
        proxyBinary(SOUNDS_UPSTREAM, res, 'application/json', 'max-age=3600')
        return
    }

    // Proxy /sounds/{id}.wav -> thirtydollar.website/sounds/{id}.wav
    // This keeps audio requests same-origin so no CORS preflight is needed.
    if (url.pathname.startsWith('/sounds/') && url.pathname !== '/sounds.json') {
        const filename    = url.pathname.slice('/sounds/'.length)
        const upstreamUrl = AUDIO_BASE + filename
        proxyBinary(upstreamUrl, res, guessAudioMime(filename), 'max-age=86400')
        return
    }

    // Serve static files from the project root
    let filePath = path.join(ROOT, url.pathname === '/' ? '/index.html' : url.pathname)

    // Prevent directory traversal
    if (!filePath.startsWith(ROOT)) {
        res.writeHead(403); res.end('Forbidden'); return
    }

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(err.code === 'ENOENT' ? 404 : 500)
            res.end(err.code === 'ENOENT' ? 'Not found' : 'Server error')
            return
        }
        const ext  = path.extname(filePath)
        const mime = MIME[ext] || 'application/octet-stream'
        res.writeHead(200, { 'Content-Type': mime })
        res.end(data)
    })
})

function proxyBinary(upstreamUrl, res, contentType, cacheControl = 'no-cache') {
    https.get(upstreamUrl, upstream => {
        if (upstream.statusCode !== 200) {
            res.writeHead(upstream.statusCode)
            res.end(`Upstream error: ${upstream.statusCode}`)
            upstream.resume()
            return
        }
        res.writeHead(200, {
            'Content-Type':  contentType,
            'Cache-Control': cacheControl,
        })
        // Stream directly instead of buffering -- important for audio files
        upstream.pipe(res)
        upstream.on('error', e => {
            console.error('Proxy stream error:', e.message)
            res.end()
        })
    }).on('error', e => {
        res.writeHead(502); res.end(`Proxy error: ${e.message}`)
    })
}

function guessAudioMime(filename) {
    const ext = path.extname(filename).toLowerCase()
    return MIME[ext] || 'audio/wav'
}

server.listen(PORT, () => {
    console.log(`TDW Editor dev server running at http://localhost:${PORT}`)
    console.log('Ctrl+C to stop.')
})
