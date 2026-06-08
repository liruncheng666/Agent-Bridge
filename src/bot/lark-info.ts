import type { LarkChannel } from '@larksuiteoapi/node-sdk';
import { log } from '../core/logger';

export interface KnownChat {
  id: string;
  name: string;
}

export interface ChatMember {
  openId: string;
  name: string;
}

export async function fetchKnownChats(channel: LarkChannel): Promise<KnownChat[]> {
  const chats: KnownChat[] = [];
  const maxPages = 5;
  let pageToken: string | undefined;
  let pages = 0;
  try {
    do {
      const params = new URLSearchParams({ page_size: '100' });
      if (pageToken) params.set('page_token', pageToken);
      const resp = await channel.rawClient.request({
        method: 'GET',
        url: `/open-apis/im/v1/chats?${params.toString()}`,
      });
      const data = (
        resp as {
          data?: {
            items?: Array<{ chat_id?: string; name?: string }>;
            has_more?: boolean;
            page_token?: string;
          };
        }
      )?.data;
      for (const item of data?.items ?? []) {
        if (item.chat_id) chats.push({ id: item.chat_id, name: item.name ?? '(无名)' });
      }
      pageToken = data?.has_more ? data.page_token : undefined;
      pages += 1;
    } while (pageToken && pages < maxPages);
    log.info('lark-info', 'chats-fetched', {
      count: chats.length,
      pages,
      truncated: Boolean(pageToken),
    });
    return chats;
  } catch (err) {
    log.warn('lark-info', 'chats-fetch-failed', {
      err: err instanceof Error ? err.message : String(err),
      partialCount: chats.length,
    });
    return chats;
  }
}

/**
 * Fetch display names for a list of open_ids by looking them up in the
 * given chat's member list. Returns a map of openId → displayName.
 * Falls back to the last 6 chars of openId when name is unavailable.
 * Requires the bot to be a member of the chat.
 */
export async function fetchMemberNames(
  channel: LarkChannel,
  chatId: string,
  openIds: readonly string[],
): Promise<Map<string, string>> {
  const nameMap = new Map<string, string>();
  if (openIds.length === 0) return nameMap;

  try {
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        member_id_type: 'open_id',
        page_size: '100',
      });
      if (pageToken) params.set('page_token', pageToken);
      const resp = await channel.rawClient.request({
        method: 'GET',
        url: `/open-apis/im/v1/chats/${chatId}/members?${params.toString()}`,
      });
      const data = (
        resp as {
          data?: {
            items?: Array<{ member_id?: string; name?: string }>;
            has_more?: boolean;
            page_token?: string;
          };
        }
      )?.data;
      for (const item of data?.items ?? []) {
        if (item.member_id) {
          nameMap.set(item.member_id, item.name ?? `...${item.member_id.slice(-6)}`);
        }
      }
      pageToken = data?.has_more ? data.page_token : undefined;
    } while (pageToken);
  } catch (err) {
    log.warn('lark-info', 'members-fetch-failed', {
      chatId,
      err: err instanceof Error ? err.message : String(err),
    });
  }

  // For any openId not found in the member list, fall back to short ID.
  for (const id of openIds) {
    if (!nameMap.has(id)) {
      nameMap.set(id, `...${id.slice(-6)}`);
    }
  }
  return nameMap;
}
