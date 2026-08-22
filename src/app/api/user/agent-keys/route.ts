import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  generateAgentApiKey,
  getAgentApiKeyPrefix,
  hashAgentApiKey
} from '@/lib/agentKey'
import { checkRateLimit, createRateLimitResponse, rateLimitConfigs } from '@/lib/rateLimit'
import { getSessionUserId } from '@/lib/sessionAuth'
import { createServiceClient } from '@/lib/supabaseServer'

export const dynamic = 'force-dynamic'

const supabase = createServiceClient()
const MAX_ACTIVE_KEYS = 5

function cleanLabel(value: string): string {
  return value
    // Labels are single-line identifiers, so strip every ASCII control
    // character rather than preserving tabs or newlines.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
}

const createKeySchema = z
  .object({
    label: z
      .string()
      .transform(cleanLabel)
      .refine((label) => [...label].length >= 1 && [...label].length <= 40, {
        message: 'Label must be 1-40 characters'
      })
  })
  .strict()

const revokeKeySchema = z
  .object({
    id: z.number().int().positive()
  })
  .strict()

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionUserId(request)
    if (!session.ok) {
      return NextResponse.json(
        { success: false, error: session.error },
        { status: session.status }
      )
    }

    // Deliberately exclude key_hash: neither the stored digest nor the
    // one-time plaintext belongs in a list response.
    const { data, error } = await supabase
      .from('agent_api_keys')
      .select('id, key_prefix, label, created_at, last_used_at, revoked_at')
      .eq('user_id', session.userId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('[AgentKeys] List failed:', error)
      return NextResponse.json(
        { success: false, error: 'Failed to load agent keys' },
        { status: 500 }
      )
    }

    const keys = (data ?? []).map((row) => ({
      id: Number(row.id),
      prefix: row.key_prefix,
      label: row.label,
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at,
      revokedAt: row.revoked_at
    }))

    return NextResponse.json({ success: true, keys })
  } catch (error) {
    console.error('[AgentKeys] GET error:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const rateLimitResult = checkRateLimit(request, rateLimitConfigs.auth)
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { success: false, error: 'Too many attempts. Please try again later.' },
        { status: 429, headers: createRateLimitResponse(rateLimitResult) }
      )
    }

    const session = await getSessionUserId(request)
    if (!session.ok) {
      return NextResponse.json(
        { success: false, error: session.error },
        { status: session.status }
      )
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body' },
        { status: 400 }
      )
    }

    const parsed = createKeySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Invalid payload', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const { count, error: countError } = await supabase
      .from('agent_api_keys')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', session.userId)
      .is('revoked_at', null)

    if (countError) {
      console.error('[AgentKeys] Active-key count failed:', countError)
      return NextResponse.json(
        { success: false, error: 'Failed to create agent key' },
        { status: 500 }
      )
    }
    if ((count ?? 0) >= MAX_ACTIVE_KEYS) {
      return NextResponse.json(
        { success: false, error: 'Maximum of 5 active agent keys reached' },
        { status: 409 }
      )
    }

    const key = generateAgentApiKey()
    const prefix = getAgentApiKeyPrefix(key)
    const { data: created, error: insertError } = await supabase
      .from('agent_api_keys')
      .insert({
        user_id: session.userId,
        key_hash: hashAgentApiKey(key),
        key_prefix: prefix,
        label: parsed.data.label
      })
      .select('id, created_at')
      .single()

    if (insertError || !created) {
      console.error('[AgentKeys] Create failed:', insertError)
      return NextResponse.json(
        { success: false, error: 'Failed to create agent key' },
        { status: 500 }
      )
    }

    return NextResponse.json(
      {
        success: true,
        key,
        prefix,
        label: parsed.data.label,
        id: Number(created.id),
        createdAt: created.created_at
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('[AgentKeys] POST error:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getSessionUserId(request)
    if (!session.ok) {
      return NextResponse.json(
        { success: false, error: session.error },
        { status: session.status }
      )
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body' },
        { status: 400 }
      )
    }

    const parsed = revokeKeySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Invalid payload', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    // Read by id first so a missing key is distinguishable from a key that
    // exists but belongs to another account, as required by the contract.
    const { data: key, error: lookupError } = await supabase
      .from('agent_api_keys')
      .select('user_id, revoked_at')
      .eq('id', parsed.data.id)
      .maybeSingle()

    if (lookupError) {
      console.error('[AgentKeys] Revoke lookup failed:', lookupError)
      return NextResponse.json(
        { success: false, error: 'Failed to revoke agent key' },
        { status: 500 }
      )
    }
    if (!key) {
      return NextResponse.json(
        { success: false, error: 'Agent key not found' },
        { status: 404 }
      )
    }
    if (Number(key.user_id) !== session.userId) {
      return NextResponse.json(
        { success: false, error: 'Forbidden' },
        { status: 403 }
      )
    }

    // A second revoke is a successful no-op and preserves the original
    // revocation timestamp.
    if (key.revoked_at) {
      return NextResponse.json({ success: true })
    }

    const { error: updateError } = await supabase
      .from('agent_api_keys')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', parsed.data.id)
      .eq('user_id', session.userId)

    if (updateError) {
      console.error('[AgentKeys] Revoke failed:', updateError)
      return NextResponse.json(
        { success: false, error: 'Failed to revoke agent key' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[AgentKeys] DELETE error:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
