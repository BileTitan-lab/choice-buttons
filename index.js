const KEY = 'choice-buttons';
let busy = false;
let timer;
let settings;
const context = () => window.SillyTavern.getContext();

export function parseChoices(text) {
    const match = /<choices\s*>([\s\S]*?)<\/choices\s*>/i.exec(text || '');
    if (!match) return [];
    let values;
    try {
        values = JSON.parse(match[1].trim());
        if (!Array.isArray(values)) return [];
    } catch (error) {
        console.log('[choice-buttons] 使用文本降级解析');
        values = match[1].trim().replace(/^\[|\]$/g, '').split(/[\r\n、]+/);
        values = values.map(value => value.trim()
            .replace(/^(?:[-*•]|\d+[.．、)）]|[一二三四五六七八九十]+[、.．])\s*/, '')
            .replace(/^["'“‘]+|["'”’，,]+$/g, ''));
    }
    return values.filter(value => typeof value === 'string')
        .map(value => value.trim()).filter(Boolean);
}

export async function sendChoice(text) {
    if (busy || !text) return;
    busy = true;
    const ctx = context();
    const chat = ctx.chat;
    const count = chat.length;
    try {
        // 特殊 STscript 语法交给输入框，避免被解释为第二条命令。
        if (typeof ctx.executeSlashCommandsWithOptions === 'function' &&
            !/[\\|{}"\r\n=]/.test(text) && !/^\s*\//.test(text)) {
            try {
                const result = await ctx.executeSlashCommandsWithOptions('/send ' + text, {
                    handleParserErrors: false, handleExecutionErrors: false,
                });
                if (result && result.isAborted) throw new Error('发送已中止');
                if (chat.length > count) return;
            } catch (error) {
                console.warn('[choice-buttons] slash 发送失败', error);
                // 已插入消息后的错误不能再次发送。
                if (chat.length > count) return;
            }
        }
        if (context().chat !== chat) throw new Error('聊天已切换，请重新选择');
        if (/^\s*\//.test(text)) throw new Error('选项不能以 / 开头，以免执行命令');
        const input = document.querySelector('#send_textarea');
        const send = document.querySelector('#send_but');
        if (!input || !send || input.disabled || send.disabled || !send.getClientRects().length) {
            throw new Error('发送控件暂不可用');
        }
        if (input.value.trim()) throw new Error('请先发送或清空输入框中的草稿');
        input.value = text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        send.click();
    } catch (error) {
        console.error('[choice-buttons]', error);
        window.alert('选项未发送：' + error.message);
    } finally {
        busy = false;
    }
}

export function hideRawChoices(root, hide) {
    if (!root) return;
    root.querySelectorAll('[data-ct-hidden]').forEach(el => {
        el.classList.remove('ct-hidden');
        el.removeAttribute('data-ct-hidden');
    });
    root.querySelectorAll('span[data-ct-wrap]').forEach(el => {
        const parent = el.parentNode;
        if (!parent) return;
        while (el.firstChild) parent.insertBefore(el.firstChild, el);
        parent.removeChild(el);
        parent.normalize();
    });
    if (!hide) return;
    root.querySelectorAll('choices').forEach(el => {
        el.classList.add('ct-hidden');
        el.setAttribute('data-ct-hidden', '');
    });
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let text = '';
    let node;
    while ((node = walker.nextNode())) {
        if (node.parentElement && node.parentElement.closest('.choice-buttons, choices')) continue;
        nodes.push({ node, start: text.length, end: text.length + node.data.length });
        text += node.data;
    }
    const regex = /<choices\s*>[\s\S]*?<\/choices\s*>/gi;
    const ranges = [];
    let match;
    while ((match = regex.exec(text))) ranges.push([match.index, regex.lastIndex]);
    ranges.reverse().forEach(range => {
        nodes.slice().reverse().forEach(entry => {
            const start = Math.max(range[0], entry.start) - entry.start;
            const end = Math.min(range[1], entry.end) - entry.start;
            if (end <= start) return;
            const part = entry.node.splitText(start);
            part.splitText(end - start);
            const span = document.createElement('span');
            span.className = 'ct-hidden';
            span.setAttribute('data-ct-wrap', '');
            if (part.parentNode) {
                part.parentNode.insertBefore(span, part);
                span.appendChild(part);
            }
        });
    });
}

export function renderButtons() {
    const ctx = context();
    document.querySelectorAll('#chat .mes[mesid]').forEach(mes => {
        const root = mes.querySelector('.mes_text');
        const message = ctx.chat[Number(mes.getAttribute('mesid'))];
        if (!root || !message || root.querySelector('textarea')) return;
        const options = message.is_user || message.is_system ? [] : parseChoices(message.mes);
        const signature = JSON.stringify(options);
        const existing = root.querySelector('.choice-buttons');
        if (existing && existing.dataset.choices !== signature) existing.remove();
        hideRawChoices(root, options.length > 0 && settings.hideRaw);
        if (!options.length || root.querySelector('.choice-buttons')) return;
        const row = document.createElement('div');
        row.className = 'choice-buttons';
        row.dataset.choices = signature;
        row.setAttribute('role', 'group');
        row.setAttribute('aria-label', '回复选项');
        options.forEach(option => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'choice-btn';
            button.textContent = option;
            button.addEventListener('click', async () => {
                if (busy) return;
                button.disabled = true;
                try { await sendChoice(option); }
                finally { button.disabled = false; }
            });
            row.appendChild(button);
        });
        root.appendChild(row);
    });
}

function refresh() {
    clearTimeout(timer);
    timer = setTimeout(() => {
        try { renderButtons(); }
        catch (error) { console.error('[choice-buttons] 渲染失败', error); }
    }, 0);
}

export function init() {
    const ctx = context();
    settings = ctx.extensionSettings[KEY] || { hideRaw: false };
    ctx.extensionSettings[KEY] = settings;
    const panel = document.querySelector('#extensions_settings');
    if (panel && !document.querySelector('#choice-buttons-settings')) {
        const label = document.createElement('label');
        label.id = 'choice-buttons-settings';
        label.className = 'checkbox_label';
        const toggle = document.createElement('input');
        toggle.type = 'checkbox';
        toggle.checked = Boolean(settings.hideRaw);
        toggle.addEventListener('change', () => {
            settings.hideRaw = toggle.checked;
            ctx.saveSettingsDebounced();
            refresh();
        });
        label.appendChild(toggle);
        label.appendChild(document.createTextNode('选项按钮：隐藏原始 <choices> 文本块'));
        panel.appendChild(label);
    }
    ['CHARACTER_MESSAGE_RENDERED', 'USER_MESSAGE_RENDERED', 'MESSAGE_SWIPED',
        'MESSAGE_EDITED', 'MESSAGE_UPDATED', 'CHAT_CHANGED', 'MORE_MESSAGES_LOADED',
        'GENERATION_ENDED'].forEach(name => {
        if (ctx.eventTypes[name]) ctx.eventSource.on(ctx.eventTypes[name], refresh);
    });
    refresh();
    console.log('[choice-buttons] 已初始化');
}

let attempts = 0;
function boot() {
    try {
        if (window.SillyTavern && typeof window.SillyTavern.getContext === 'function') {
            const ctx = context();
            if (ctx.eventSource && ctx.eventTypes && ctx.extensionSettings &&
                document.querySelector('#extensions_settings')) {
                init();
                return;
            }
        }
    } catch (error) { console.warn('[choice-buttons] 等待初始化', error); }
    if (++attempts < 240) setTimeout(boot, 250);
    else console.error('[choice-buttons] 等待 SillyTavern 超时，请刷新网页');
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
