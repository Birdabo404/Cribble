import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json(
    { error: 'Twitter login is disabled. Use GitHub to continue.' },
    { status: 410 }
  )
}
