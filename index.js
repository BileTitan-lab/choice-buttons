const KEY = 'choice-buttons';
let busy = false;
let timer;
let settings;
let chatObserver;
const diagnostics = new WeakMap();
const context = () => window.SillyTavern.getContext();

function normalizeChoiceText(text) {
    // 只处理文本副本，不通过 innerHTML 执行或改写消息。
    for (let i = 0; i < 2; i++) {
        text = text.replace(/&amp;|&#0*38;|&#x0*26;/gi, '&')
            .replace(/&lt;|&#0*60;|&#x0*3c;/gi, '<')
            .replace(/&gt;|&#0*62;|&#x0*3e;/gi, '>');
    }
    text = text.replace(/[\u200B\u2060\uFEFF]/g, '');
    // 保留选项字符串中的字面 HTML；仅移除数组外的格式标签。
    return text.replace(/"(?:[^"\\]|\\.)*"|“[^“”]*”|<\/?[a-z][^>]*>|[\u200C\u200D]/gi, part => {
        if (/^[\u200C\u200D]$/.test(part)) return '';
        if (part[0] !== '<') return part;
        part = part.replace(/[\u200C\u200D]/g, '');
        if (/^<\/?choices\s*>$/i.test(part)) return part;
        return /^<\/?(?:br|p|div|li|pre)\b/i.test(part) ? '\n' : '';
    });
}

export function getRawText(mesEl) {
    const id = mesEl && mesEl.getAttribute('mesid');
    const mesId = id !== null && /^\d+$/.test(id) ? Number(id) : -1;
    const ctx = context();
    const message = ctx.chat && ctx.chat[mesId];
    if (message && typeof message.mes === 'string') return message.mes;
    const root = mesEl && mesEl.querySelector('.mes_text');
    if (!root) return '';
    const copy = root.cloneNode(true);
    copy.querySelectorAll('.choice-buttons').forEach(row => row.remove());
    return copy.innerText || copy.textContent || '';
}

export function parseChoices(text) {
    if (typeof text !== 'string') return [];
    text = normalizeChoiceText(text);
    // 只接受回复末尾的明确标记；普通 JSON、教程正文不能作为候选选项。
    const match = /(?:^|\n)[ \t]*<choices\s*>([\s\S]*?)<\/choices\s*>\s*$/i.exec(text) ||
        /(?:^|\n)[ \t]*```choices[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```\s*$/i.exec(text);
    if (!match) return [];
    let body = match[1].trim();
    if (body[0] !== '[' || body[body.length - 1] !== ']') return [];
    let values;
    try {
        values = JSON.parse(body);
    } catch (error) {
        body = body.replace(/&quot;|&#0*34;|&#x0*22;/gi, '"');
        // 仅容忍中文双引号和尾逗号，且整个数组必须都由字符串组成。
        const token = '"(?:[^"\\\\\r\n]|\\\\.)*"|“[^“”\r\n]*”';
        const array = new RegExp('^\\[\\s*(?:' + token + ')(?:\\s*,\\s*(?:' + token + '))*\\s*,?\\s*\\]$');
        if (!array.test(body)) return [];
        try {
            values = body.match(new RegExp(token, 'g')).map(value =>
                value[0] === '“' ? value.slice(1, -1) : JSON.parse(value));
        } catch (invalidString) { return []; }
    }
    if (!Array.isArray(values) || values.length < 2 || values.length > 4 ||
        values.some(value => typeof value !== 'string' || !value.trim() || /[\r\n]/.test(value))) return [];
    return values.map(value => value.trim());
}

export async function sendChoice(text) {
    if (busy || typeof text !== 'string' || !text.trim()) return;
    busy = true;
    try {
        const ctx = context();
        if (/^\s*\//.test(text)) throw new Error('选项不能以 / 开头，以免执行命令');
        const input = document.getElementById('send_textarea');
        console.log('[choice-buttons] 输入框状态', {
            found: Boolean(input), disabled: input ? Boolean(input.disabled) : null,
        });
        if (!input || input.disabled || input.readOnly) throw new Error('输入框暂不可用');
        if (input.value.trim()) throw new Error('请先发送或清空输入框中的草稿');
        input.value = text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        console.log('[choice-buttons] 已填写选项并派发 input 事件');
        await new Promise(resolve => setTimeout(resolve, 50));
        const current = context();
        if (current.chat !== ctx.chat || current.chatId !== ctx.chatId) {
            throw new Error('聊天已切换，请重新选择');
        }
        if (document.getElementById('send_textarea') !== input || input.value !== text ||
            input.disabled || input.readOnly) throw new Error('输入框状态已改变，请手动发送');
        const send = document.getElementById('send_but');
        const disabled = send && (Boolean(send.disabled) || send.hasAttribute('disabled') ||
            send.getAttribute('aria-disabled') === 'true');
        const visible = send && send.getClientRects().length > 0;
        console.log('[choice-buttons] 发送按钮状态', {
            found: Boolean(send), disabled: Boolean(disabled), visible: Boolean(visible),
        });
        if (!send || disabled || !visible) throw new Error('发送按钮暂不可用，选项已保留在输入框中');
        // 1.19.0 的 send_form 是 div；点击 send_but 才会进入正常生成流程。
        send.click();
        console.log('[choice-buttons] 已点击发送按钮，由酒馆处理消息与生成');
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
        const mesId = Number(mes.getAttribute('mesid'));
        const message = ctx.chat[mesId];
        if (!root || !message || root.querySelector('textarea')) return;
        const raw = getRawText(mes);
        const options = message.is_user || message.is_system ? [] : parseChoices(raw);
        if (!message.is_user && !message.is_system && !options.length &&
            /<choices\b/i.test(normalizeChoiceText(raw)) && diagnostics.get(message) !== raw) {
            console.log('[choice-buttons] 检测到 choices 但未解析到有效选项', {
                mesId, preview: raw.slice(0, 200),
            });
            diagnostics.set(message, raw);
        } else if (options.length) diagnostics.delete(message);
        const signature = JSON.stringify(options);
        const existing = root.querySelector('.choice-buttons');
        if (existing && existing.dataset.choices !== signature) existing.remove();
        if (existing && existing.dataset.choices === signature &&
            existing.dataset.hideRaw === String(Boolean(settings.hideRaw))) return;
        hideRawChoices(root, options.length > 0 && settings.hideRaw);
        if (existing && existing.dataset.choices === signature) {
            existing.dataset.hideRaw = String(Boolean(settings.hideRaw));
        }
        if (!options.length || root.querySelector('.choice-buttons')) return;
        const row = document.createElement('div');
        row.className = 'choice-buttons';
        row.dataset.choices = signature;
        row.dataset.hideRaw = String(Boolean(settings.hideRaw));
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
        if (chatObserver) chatObserver.disconnect();
        try { renderButtons(); }
        catch (error) { console.error('[choice-buttons] 渲染失败', error); }
        finally {
            const chat = document.getElementById('chat');
            if (chat && chatObserver) chatObserver.observe(chat, {
                childList: true, subtree: true, characterData: true,
            });
        }
    }, 50);
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
    // 助手可能在酒馆渲染事件之后重新创建 mes_text，恢复被替换的按钮。
    if (!chatObserver && typeof MutationObserver === 'function') chatObserver = new MutationObserver(refresh);
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
