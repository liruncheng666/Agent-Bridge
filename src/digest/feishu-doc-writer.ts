import type { NotificationConfig } from '../config/schema';
import type { PostContent } from './format';
import { log } from '../core/logger';

/**
 * Append a notification's content to a Feishu cloud document.
 * The document is identified by a URL (https://xxx.feishu.cn/docx/TOKEN)
 * or a bare document token.
 *
 * Content is appended as a heading (H2 = date) + text blocks.
 * Requires the bot to have editor access to the document.
 * Failures are logged and optionally surfaced to the owner — never thrown.
 */
export async function appendToFeishuDoc(
  notification: NotificationConfig,
  post: PostContent,
  dateKey: string,
  rawClient: import('@larksuiteoapi/node-sdk').Client,
  ownerOpenId: string,
): Promise<void> {
  const docUrl = notification.feishuDocUrl;
  if (!docUrl) return;

  const docToken = extractDocToken(docUrl);
  if (!docToken) {
    log.warn('digest', 'feishu-doc-bad-url', {
      notificationId: notification.id,
      docUrl,
    });
    return;
  }

  const { title, content } = post.zh_cn;
  const dateLabel = `${dateKey.slice(0, 4)}-${dateKey.slice(4, 6)}-${dateKey.slice(6, 8)}`;

  // Build blocks: H2 heading (date · title) + paragraph lines
  const blocks: object[] = [
    {
      block_type: 2, // heading2
      heading2: {
        elements: [{ type: 'text_run', text_run: { content: `${dateLabel} · ${title}` } }],
        style: { align: 1 },
      },
    },
    ...content.map((line) => ({
      block_type: 6, // text / paragraph
      text: {
        elements: [{ type: 'text_run', text_run: { content: line.map((s) => s.text).join('') } }],
        style: { align: 1 },
      },
    })),
  ];

  try {
    // Fetch the document's last block index to append after it
    const docResp = await (rawClient as unknown as DocxClient).docx.v1.document.rawContent({
      path: { document_id: docToken },
      params: { lang: 0 },
    });
    const blockCount = (docResp as { data?: { block_count?: number } })?.data?.block_count ?? 0;

    await (rawClient as unknown as DocxClient).docx.v1.documentBlock.batchCreate({
      path: { document_id: docToken },
      params: {
        document_revision_id: -1,
        client_token: `digest-${notification.id}-${dateKey}`,
      },
      data: {
        children: blocks,
        index: blockCount,
      },
    });
    log.info('digest', 'feishu-doc-ok', { notificationId: notification.id, docToken });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn('digest', 'feishu-doc-failed', {
      notificationId: notification.id,
      docToken,
      err: msg,
    });
    // Notify owner about the failure via private message (best-effort)
    void notifyOwnerDocFailure(rawClient, ownerOpenId, notification.id, msg);
  }
}

async function notifyOwnerDocFailure(
  rawClient: import('@larksuiteoapi/node-sdk').Client,
  ownerOpenId: string,
  notificationId: string,
  errMsg: string,
): Promise<void> {
  try {
    await rawClient.im.v1.message.create({
      params: { receive_id_type: 'open_id' },
      data: {
        receive_id: ownerOpenId,
        msg_type: 'text',
        content: JSON.stringify({
          text: `⚠️ 定时通知「${notificationId}」写入飞书云文档失败：${errMsg.slice(0, 200)}`,
        }),
      },
    });
  } catch {
    // best-effort only
  }
}

/** Extract the document token from a Feishu doc URL or bare token. */
function extractDocToken(input: string): string | null {
  // bare token (no slash)
  if (!input.includes('/')) return input || null;
  // URL pattern: .../docx/<token> or .../doc/<token>
  const match = /\/(?:docx|doc|wiki)\/([A-Za-z0-9_-]+)/.exec(input);
  return match?.[1] ?? null;
}

// Minimal type shim for the docx API (not fully typed in the SDK bundle).
interface DocxClient {
  docx: {
    v1: {
      document: {
        rawContent(payload: {
          path: { document_id: string };
          params: { lang: number };
        }): Promise<unknown>;
      };
      documentBlock: {
        batchCreate(payload: {
          path: { document_id: string };
          params: { document_revision_id: number; client_token: string };
          data: { children: object[]; index: number };
        }): Promise<unknown>;
      };
    };
  };
}
