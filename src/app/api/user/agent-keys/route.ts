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
const DEFAULT_KEY_LIFETIME_DAYS = 90

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
      }),
    expiresInDays: z.number().int().min(7).max(365).optional()
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
      .select(
        'id, key_prefix, label, created_at, last_used_at, revoked_at, expires_at, agent_usage_clients!agent_usage_clients_last_key_id_fkey(client_id, machine_name, timezone, last_seen_at, schema_version)'
      )
      .eq('user_id', session.userId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('[AgentKeys] List failed:', error)
      return NextResponse.json(
        { success: false, error: 'Failed to load agent keys' },
        { status: 500 }
      )
    }

    const keys = (data ?? []).map((row) => {
      const clients = (
        (row as unknown as {
          agent_usage_clients?: Array<{
            client_id: string
            machine_name: string
            timezone: string | null
            last_seen_at: string
            schema_version: number
          }>
        }).agent_usage_clients ?? []
      ).map((client) => ({
        id: client.client_id,
        machineName: client.machine_name,
        timezone: client.timezone,
        lastSeenAt: client.last_seen_at,
        schemaVersion: Number(client.schema_version)
      }))

      return {
        id: Number(row.id),
        prefix: row.key_prefix,
        label: row.label,
        createdAt: row.created_at,
        lastUsedAt: row.last_used_at,
        revokedAt: row.revoked_at,
        expiresAt: row.expires_at,
        clients
      }
    })

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

    const key = generateAgentApiKey()
    const prefix = getAgentApiKeyPrefix(key)
    const expiresInDays = parsed.data.expiresInDays ?? DEFAULT_KEY_LIFETIME_DAYS
    const expiresAt = new Date(Date.now() + expiresInDays * 86_400_000).toISOString()
    const { data: createData, error: insertError } = await supabase.rpc(
      'create_agent_api_key',
      {
        p_user_id: session.userId,
        p_key_hash: hashAgentApiKey(key),
        p_key_prefix: prefix,
        p_label: parsed.data.label,
        p_expires_at: expiresAt
      }
    )
    const created = (Array.isArray(createData) ? createData[0] : createData) as
      | { id: number | string; created_at: string; expires_at: string }
      | null

    if (insertError || !created) {
      if (insertError?.message?.includes('agent_key_limit')) {
        return NextResponse.json(
          { success: false, error: 'Maximum of 5 active agent keys reached' },
          { status: 409 }
        )
      }
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
        createdAt: created.created_at,
        expiresAt: created.expires_at
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
