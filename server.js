// Simple dev server for tdw-editor. No npm required -- just Node.js built-ins.
// Serves static files and proxies TDW's sounds.json to sidestep CORS.
//
// Usage: node server.js
// Then open: http://localhost:3000/test.html

import http     from 'http'
import https    from 'https'
import fs       from 'fs'
import path     from 'path'
import { fileURLToPath } from 'url'

const PORT    = 3000
const ROOT    = path.dirname(fileURLToPath(import.meta.url))

// Proxy target for sound metadata -- keeps CORS out of our hair during dev
const SOUNDS_UPSTREAM = 'https://thirtydollar.website/sounds.json?v=2'

const MIME = {
    '.html': 'text/html',
    '.js':   'text/javascript',
    '.json': 'application/json',
    '.css':  'text/css',
    '.png':  'image/png',
    '.svg':  'image/svg+xml',
    '.wav':  'audio/wav',
}

const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`)

    // Proxy /sounds.json to TDW so the browser never makes a cross-origin request
    if (url.pathname === '/sounds.json') {
        proxyJSON(SOUNDS_UPSTREAM, res)
        return
    }

    // Serve static files from the project root
    let filePath = path.join(ROOT, url.pathname === '/' ? '/test.html' : url.pathname)

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

function proxyJSON(upstreamUrl, res) {
    https.get(upstreamUrl, upstream => {
        const chunks = []
        upstream.on('data', c => chunks.push(c))
        upstream.on('end', () => {
            const body = Buffer.concat(chunks)
            res.writeHead(200, {
                'Content-Type':  'application/json',
                'Cache-Control': 'max-age=3600',
            })
            res.end(body)
        })
        upstream.on('error', e => {
            res.writeHead(502); res.end(`Proxy error: ${e.message}`)
        })
    }).on('error', e => {
        res.writeHead(502); res.end(`Proxy error: ${e.message}`)
    })
}

server.listen(PORT, () => {
    console.log(`TDW Editor dev server running at http://localhost:${PORT}/test.html`)
    console.log('Ctrl+C to stop.')
})
