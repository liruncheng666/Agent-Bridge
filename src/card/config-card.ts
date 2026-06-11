import type { KnownChat } from '../bot/lark-info';
import type { GroupRoleConfig } from '../config/profile-schema';
import type { MessageReplyMode } from '../config/schema';
import type { NotificationConfig } from '../config/schema';

export interface ConfigFormOpts {
  messageReply: MessageReplyMode;
  showToolCalls: boolean;
  maxConcurrentRuns: number;
  /** 0 means "disabled". */
  runIdleTimeoutMinutes: number;
  requireMentionInGroup: boolean;
  allowedUsers: string[];
  allowedChats: string[];
  admins: string[];
  knownChats: KnownChat[];
  /** All group role configs keyed by chatId. Used in p2p /config to show group role management. */
  groupRoles?: Record<string, GroupRoleConfig>;
  /** Current notification list for the digest notifications panel. */
  notifications?: NotificationConfig[];
}

function groupRolesPanel(opts: ConfigFormOpts): object[] {
  const knownChats = opts.knownChats;
  const groupRoles = opts.groupRoles ?? {};

  if (knownChats.length === 0) {
    return [{
      tag: 'markdown',
      content: '_bot 暂不在任何群里，无群角色可管理。_',
    }];
  }

  const elements: object[] = [
    {
      tag: 'markdown',
      content:
        '_每个群独立配置。**讨论人**可读写 workspace；**参与人**仅读；**未指定**按群策略处理。_\n\n' +
        '_修改角色请在群里发 `/role @某人 讨论人|参与人|移除`，或私聊发 `/role <群名> @某人 讨论人`。_',
    },
    { tag: 'hr' },
  ];

  for (let i = 0; i < knownChats.length; i++) {
    const chat = knownChats[i]!;
    const cfg = groupRoles[chat.id];
    const collabCount = cfg?.collaborators.length ?? 0;
    const partCount = cfg?.participants.length ?? 0;
    const policy = cfg?.policy ?? 'strict';
    const policyLabel = policy === 'open-participant' ? '开放只读' : '严格';

    elements.push({
      tag: 'markdown',
      content:
        `**${chat.name}**\n` +
        `讨论人 ${collabCount} 人 ／ 参与人 ${partCount} 人 ／ 策略：${policyLabel}\n\n` +
        `_改策略：群内发 \`/role list\` 查看，或私聊发 \`/role ${chat.name} list\`_`,
    });

    // Use 1-based index as name — guaranteed unique within the form
    elements.push({
      tag: 'select_static',
      name: 'grp' + String(i),
      initial_option: policy,
      options: [
        { text: { tag: 'plain_text', content: '严格（未指定的人不响应）' }, value: 'strict' },
        { text: { tag: 'plain_text', content: '开放只读（群里人默认参与人）' }, value: 'open-participant' },
      ],
    });

    elements.push({ tag: 'hr' });
  }

  if (elements.length > 0 && (elements[elements.length - 1] as { tag?: string }).tag === 'hr') {
    elements.pop();
  }

  return elements;
}

/** Build the notifications management panel for /config.
 *  IMPORTANT: this panel must live OUTSIDE the main config form so that
 *  its callback buttons are not swallowed by the form's submit handler.
 */
function notificationsPanel(notifications: NotificationConfig[]): object[] {
  const elements: object[] = [
    {
      tag: 'markdown',
      content: '_每条通知独立配置触发时间、类型和存储路径。新增或编辑后立即生效，无需重启。_',
    },
    { tag: 'hr' },
  ];

  if (notifications.length === 0) {
    elements.push({
      tag: 'markdown',
      content: '_暂无通知，点下方按钮新增。_',
    });
  }

  for (const n of notifications) {
    const typeLabel = n.type === 'ai' ? '🤖 AI 分析' : '📊 基础统计';
    const at = n.at ?? '08:00';
    const enabledLabel = n.enabled !== false ? '✅ 已启用' : '⭕ 已关闭';
    const storageInfo = [
      n.localStoragePath ? `💾 本地` : '',
      n.feishuDocUrl ? `📄 云文档` : '',
    ].filter(Boolean).join('  ');

    elements.push({
      tag: 'markdown',
      content:
        `**${n.name}**\n` +
        `${enabledLabel}　${typeLabel}　⏰ ${at}` +
        (storageInfo ? `　${storageInfo}` : ''),
    });

    elements.push({
      tag: 'column_set',
      flex_mode: 'flow',
      horizontal_spacing: 'small',
      columns: [
        {
          tag: 'column',
          width: 'auto',
          elements: [{
            tag: 'button',
            text: { tag: 'plain_text', content: '✏️ 编辑' },
            type: 'default',
            size: 'small',
            behaviors: [{ type: 'callback', value: { cmd: 'digest.notification.edit', arg: n.id } }],
          }],
        },
        {
          tag: 'column',
          width: 'auto',
          elements: [{
            tag: 'button',
            text: { tag: 'plain_text', content: '▶ 立即触发' },
            type: 'default',
            size: 'small',
            behaviors: [{ type: 'callback', value: { cmd: 'digest.notification.trigger', arg: n.id } }],
          }],
        },
        {
          tag: 'column',
          width: 'auto',
          elements: [{
            tag: 'button',
            text: { tag: 'plain_text', content: '🗑 删除' },
            type: 'danger',
            size: 'small',
            behaviors: [{ type: 'callback', value: { cmd: 'digest.notification.delete', arg: n.id } }],
          }],
        },
      ],
    });
    elements.push({ tag: 'hr' });
  }

  if (elements.length > 0 && (elements[elements.length - 1] as { tag?: string }).tag === 'hr') {
    elements.pop();
  }

  elements.push({ tag: 'hr' });
  elements.push({
    tag: 'button',
    text: { tag: 'plain_text', content: '➕ 新增通知' },
    type: 'primary',
    behaviors: [{ type: 'callback', value: { cmd: 'digest.notification.add' } }],
  });

  return elements;
}

/** Build the notification edit form card (sent as a new card when user clicks 编辑). */
export function notificationEditCard(n: NotificationConfig): object {
  return {
    schema: '2.0',
    config: { summary: { content: `编辑通知：${n.name}` } },
    body: {
      elements: [
        {
          tag: 'markdown',
          content: `⚙️ **编辑通知：${n.name}**`,
        },
        { tag: 'hr' },
        {
          tag: 'form',
          name: 'notification_edit_form',
          elements: [
            { tag: 'markdown', content: '**名称**' },
            {
              tag: 'input',
              name: 'notif_name',
              default_value: n.name,
              placeholder: { tag: 'plain_text', content: '通知名称' },
              input_type: 'text',
            },
            { tag: 'markdown', content: '\n**类型**' },
            {
              tag: 'select_static',
              name: 'notif_type',
              initial_option: n.type,
              options: [
                { text: { tag: 'plain_text', content: '📊 基础统计（无 AI）' }, value: 'basic' },
                { text: { tag: 'plain_text', content: '🤖 AI 分析' }, value: 'ai' },
              ],
            },
            { tag: 'markdown', content: '\n**触发时间（HH:MM，24小时制）**' },
            {
              tag: 'input',
              name: 'notif_at',
              default_value: n.at ?? '08:00',
              placeholder: { tag: 'plain_text', content: '08:00' },
              input_type: 'text',
            },
            { tag: 'markdown', content: '\n**启用状态**' },
            {
              tag: 'select_static',
              name: 'notif_enabled',
              initial_option: n.enabled !== false ? 'true' : 'false',
              options: [
                { text: { tag: 'plain_text', content: '✅ 启用' }, value: 'true' },
                { text: { tag: 'plain_text', content: '⭕ 关闭' }, value: 'false' },
              ],
            },
            {
              tag: 'markdown',
              content:
                '\n**AI 分析 Prompt**\n' +
                '_类型为「AI 分析」时生效。必须含 `{LOG_DATA}` 占位符；可选含 `{GIT_LOG}` 自动注入最近 git 提交。留空使用内置默认。最多 2000 字。_',
            },
            {
              tag: 'input',
              name: 'notif_prompt',
              default_value: n.prompt ?? '',
              placeholder: { tag: 'plain_text', content: '留空使用内置默认 prompt' },
              input_type: 'multiline_text',
              max_length: 1000,
            },
            { tag: 'markdown', content: '\n**AI 分析模型**（留空使用全局默认）' },
            {
              tag: 'input',
              name: 'notif_model',
              default_value: n.model ?? '',
              placeholder: { tag: 'plain_text', content: 'claude-sonnet-4-6（留空=全局默认）' },
              input_type: 'text',
            },
            { tag: 'markdown', content: '\n**本地存储目录**（留空关闭）' },
            {
              tag: 'input',
              name: 'notif_local_path',
              default_value: n.localStoragePath ?? '',
              placeholder: { tag: 'plain_text', content: '/Users/xxx/digests' },
              input_type: 'text',
            },
            { tag: 'markdown', content: '\n**飞书云文档 URL**（留空关闭）' },
            {
              tag: 'input',
              name: 'notif_feishu_doc',
              default_value: n.feishuDocUrl ?? '',
              placeholder: { tag: 'plain_text', content: 'https://xxx.feishu.cn/docx/...' },
              input_type: 'text',
            },
            { tag: 'hr' },
            {
              tag: 'column_set',
              flex_mode: 'flow',
              horizontal_spacing: 'small',
              columns: [
                {
                  tag: 'column',
                  width: 'auto',
                  elements: [{
                    tag: 'button',
                    name: 'save_btn',
                    text: { tag: 'plain_text', content: '保存' },
                    type: 'primary',
                    form_action_type: 'submit',
                    behaviors: [{ type: 'callback', value: { cmd: 'digest.notification.save', arg: n.id } }],
                  }],
                },
                {
                  tag: 'column',
                  width: 'auto',
                  elements: [{
                    tag: 'button',
                    text: { tag: 'plain_text', content: '取消' },
                    behaviors: [{ type: 'callback', value: { cmd: 'digest.notification.cancel' } }],
                  }],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

function collapsedPanel(title: string, elements: object[], expanded = false): object {
  return {
    tag: 'collapsible_panel',
    expanded,
    header: {
      title: { tag: 'markdown', content: title },
      vertical_align: 'center',
      icon: {
        tag: 'standard_icon',
        token: 'down-small-ccm_outlined',
        size: '16px 16px',
      },
      icon_position: 'follow_text',
      icon_expanded_angle: -180,
    },
    border: { color: 'blue', corner_radius: '5px' },
    vertical_spacing: '8px',
    padding: '8px 8px 8px 8px',
    elements,
  };
}

function atMentionLine(openIds: string[]): string {
  if (openIds.length === 0) return '_（暂无）_';
  return openIds.map((id) => `<at id="${id}"></at>`).join('  ');
}

function chatList(chatIds: string[], knownChats: KnownChat[]): string {
  if (chatIds.length === 0) return '_（暂无）_';
  const nameMap = new Map(knownChats.map((chat) => [chat.id, chat.name]));
  return chatIds
    .map((id) => `- **${nameMap.get(id) ?? '(未知群)'}**（...${id.slice(-6)}）`)
    .join('\n');
}

/** Form card for `/config`. */
export function configFormCard(opts: ConfigFormOpts): object {
  const accessElements: object[] = [
    {
      tag: 'markdown',
      content: '_控制谁能通过私聊和群聊使用 bot。**留空 = 不响应聊天消息**。云文档评论按文档权限生效。_',
    },
    { tag: 'hr' },
    {
      tag: 'markdown',
      content:
        `**允许私聊的用户**（共 ${opts.allowedUsers.length} 人）\n` +
        `${atMentionLine(opts.allowedUsers)}\n\n` +
        '_加 / 删：_ `/invite user @某人`  `/remove user @某人`',
    },
    { tag: 'hr' },
    {
      tag: 'markdown',
      content:
        `**允许响应的群**（共 ${opts.allowedChats.length} 个）\n` +
        `${chatList(opts.allowedChats, opts.knownChats)}\n\n` +
        '_一键加全部 bot 所在的群：_ `/invite all group`\n' +
        '_加 / 删（在目标群里发）：_ `/invite group`  `/remove group`',
    },
    { tag: 'hr' },
    {
      tag: 'markdown',
      content:
        `**管理员**（共 ${opts.admins.length} 人）\n` +
        `${atMentionLine(opts.admins)}\n\n` +
        '_可以跑敏感命令：`/account` `/config` `/exit` `/reconnect` `/doctor` `/cd` `/ws` `/invite` `/remove`。管理员也自动获得私聊权限，并可在未白名单群里管理访问控制。_\n\n' +
        '_加 / 删：_ `/invite admin @某人`  `/remove admin @某人`',
    },
  ];

  // Preference form elements (inside the form tag)
  const preferenceFormElements: object[] = [
    {
      tag: 'markdown',
      content:
        '**消息回复方式**\n' +
        '_纯文本:agent 跑完一次性发出,不流式,体感最轻_\n' +
        '_消息卡片:轻量流式 markdown 卡片,飞书原生打字机动画_',
    },
    {
      tag: 'select_static',
      name: 'message_reply',
      initial_option: opts.messageReply === 'card' ? 'markdown' : opts.messageReply,
      options: [
        { text: { tag: 'plain_text', content: '纯文本' }, value: 'text' },
        { text: { tag: 'plain_text', content: '消息卡片(默认)' }, value: 'markdown' },
      ],
    },
    {
      tag: 'markdown',
      content:
        '\n**工具调用显示**\n' +
        '_显示:可以看到 bot 跑了什么命令、读了哪些文件等过程_\n' +
        '_隐藏:只看 agent 最终的文字答复,跳过所有工具块_',
    },
    {
      tag: 'select_static',
      name: 'show_tool_calls',
      initial_option: opts.showToolCalls ? 'show' : 'hide',
      options: [
        { text: { tag: 'plain_text', content: '显示(默认)' }, value: 'show' },
        { text: { tag: 'plain_text', content: '隐藏' }, value: 'hide' },
      ],
    },
    {
      tag: 'markdown',
      content:
        '\n**并发上限**\n' +
        '_全局同时运行的 agent 进程数(主要影响话题群多话题并行场景)_\n' +
        '_默认 10,范围 1-50。超出的请求会 FIFO 排队_',
    },
    {
      tag: 'input',
      name: 'max_concurrent_runs',
      default_value: String(opts.maxConcurrentRuns),
      placeholder: { tag: 'plain_text', content: '10' },
      input_type: 'text',
    },
    {
      tag: 'markdown',
      content:
        '\n**run 探活(分钟)**\n' +
        '_agent 长时间没输出时自动 kill,防止假死_\n' +
        '_0 = 关闭(默认),范围 1-120。可被 `/timeout` 在单个 scope 覆盖_',
    },
    {
      tag: 'input',
      name: 'run_idle_timeout_minutes',
      default_value: String(opts.runIdleTimeoutMinutes),
      placeholder: { tag: 'plain_text', content: '0' },
      input_type: 'text',
    },
    {
      tag: 'markdown',
      content:
        '\n**群里需要 @ bot**\n' +
        '_是(默认):群和话题群里,不 @ bot 的消息不会触发回复,bot 不接群里聊天_\n' +
        '_否:任何消息都会发给 agent(0.1.21 及更早版本的行为)_\n' +
        '_私聊永远不需要 @;`@全员` 永远不响应_',
    },
    {
      tag: 'select_static',
      name: 'require_mention_in_group',
      initial_option: opts.requireMentionInGroup ? 'yes' : 'no',
      options: [
        { text: { tag: 'plain_text', content: '是(默认)' }, value: 'yes' },
        { text: { tag: 'plain_text', content: '否' }, value: 'no' },
      ],
    },
  ];

  return {
    schema: '2.0',
    config: { summary: { content: '偏好设置' } },
    body: {
      elements: [
        {
          tag: 'markdown',
          content:
            '⚙️ **偏好设置**\n\n' +
            '调整 bot 的行为偏好。改完点提交,**立即生效**(无需重启)并写入 `~/.agent-bridge/config.json`。',
        },
        { tag: 'hr' },
        {
          tag: 'form',
          name: 'config_form',
          elements: [
            // Preferences collapsed by default — form must be at body level,
            // but collapsible_panel is allowed inside form.
            collapsedPanel('🛠 **行为偏好**（点击展开配置）', preferenceFormElements),
            { tag: 'hr' },
            collapsedPanel('🔒 **访问控制**（点击展开）', accessElements),
            { tag: 'hr' },
            collapsedPanel('👥 **群角色管理**（点击展开）', groupRolesPanel(opts)),
            { tag: 'hr' },
            {
              tag: 'column_set',
              flex_mode: 'flow',
              horizontal_spacing: 'small',
              columns: [
                {
                  tag: 'column',
                  width: 'auto',
                  elements: [
                    {
                      tag: 'button',
                      name: 'submit_btn',
                      text: { tag: 'plain_text', content: '提交' },
                      type: 'primary',
                      form_action_type: 'submit',
                      behaviors: [{ type: 'callback', value: { cmd: 'config.submit' } }],
                    },
                  ],
                },
                {
                  tag: 'column',
                  width: 'auto',
                  elements: [
                    {
                      tag: 'button',
                      name: 'cancel_btn',
                      text: { tag: 'plain_text', content: '取消' },
                      behaviors: [{ type: 'callback', value: { cmd: 'config.cancel' } }],
                    },
                  ],
                },
              ],
            },
          ],
        },
        { tag: 'hr' },
        // Notifications panel — MUST be OUTSIDE the form so its callback
        // buttons are not intercepted by the form submit handler.
        collapsedPanel('🔔 **定时通知**（点击展开）', notificationsPanel(opts.notifications ?? [])),
      ],
    },
  };
}

export function configSavedCard(opts: ConfigFormOpts): object {
  const replyLabel =
    opts.messageReply === 'card'
      ? '交互卡片'
      : opts.messageReply === 'markdown'
        ? '消息卡片'
        : '纯文本';
  const summarize = (list: string[]): string =>
    list.length === 0 ? '_(空)_' : `${list.length} 项`;
  return {
    schema: '2.0',
    config: { summary: { content: '偏好已保存' } },
    body: {
      elements: [
        {
          tag: 'markdown',
          content:
            '✅ **偏好已保存**\n\n' +
            `**消息回复方式**:${replyLabel}\n` +
            `**工具调用显示**:\`${opts.showToolCalls ? 'show' : 'hide'}\`\n` +
            `**并发上限**:\`${opts.maxConcurrentRuns}\`\n` +
            `**run 探活**:\`${opts.runIdleTimeoutMinutes > 0 ? `${opts.runIdleTimeoutMinutes} 分钟` : '关闭'}\`\n` +
            `**群里需要 @ bot**:\`${opts.requireMentionInGroup ? '是' : '否'}\`\n\n` +
            '🔒 **访问控制**\n' +
            `**允许私聊的用户**:${summarize(opts.allowedUsers)}\n` +
            `**允许响应的群**:${summarize(opts.allowedChats)}\n` +
            `**管理员**:${summarize(opts.admins)}\n\n` +
            '下条消息开始生效。',
        },
      ],
    },
  };
}

export function configCancelledCard(): object {
  return {
    schema: '2.0',
    config: { summary: { content: '已取消' } },
    body: {
      elements: [{ tag: 'markdown', content: '已取消,未做任何修改。' }],
    },
  };
}
