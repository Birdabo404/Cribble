import { NextRequest, NextResponse } from 'next/server'

// Alias to /api/extension/sync (GET and POST)
export async function GET(request: NextRequest) {
  const url = new URL('/api/extension/sync', request.url)
  const upstream = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'X-Extension-Device-UUID': request.headers.get('X-Extension-Device-UUID') || '',
      'X-Extension-User-ID': request.headers.get('X-Extension-User-ID') || ''
    }
  })
  const data = await upstream.text()
  return new NextResponse(data, { status: upstream.status, headers: { 'Content-Type': 'application/json' } })
}

export async function POST(request: NextRequest) {
  const url = new URL('/api/extension/sync', request.url)
  const upstream = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: await request.text()
  })
  const data = await upstream.text()
  return new NextResponse(data, { status: upstream.status, headers: { 'Content-Type': 'application/json' } })
}


