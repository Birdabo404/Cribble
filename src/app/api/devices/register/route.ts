import { NextRequest, NextResponse } from 'next/server'

// Alias to /api/extension/devices (POST)
export async function POST(request: NextRequest) {
  const url = new URL('/api/extension/devices', request.url)
  const upstream = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: await request.text()
  })
  const data = await upstream.text()
  return new NextResponse(data, { status: upstream.status, headers: { 'Content-Type': 'application/json' } })
}


