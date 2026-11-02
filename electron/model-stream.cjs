const { WorkbenchError } = require('./git-service.cjs');

// Decode SSE lines independently of TCP/UTF-8 chunk boundaries.
async function readCompletionStream(reader, onContent) {
  const decoder = new TextDecoder();
  let buffer = '',
    data = [],
    content = '',
    usage,
    finishReason,
    ended = false,
    size = 0;
  const dispatch = () => {
    if (!data.length) return;
    const payload = data.join('\n');
    data = [];
    if (ended) return;
    if (payload === '[DONE]') {
      ended = true;
      return;
    }
    let chunk;
    try {
      chunk = JSON.parse(payload);
    } catch {
      throw new WorkbenchError('模型流返回了无效数据，请重试。', 'MODEL_INVALID_RESPONSE');
    }
    if (chunk?.error)
      throw new WorkbenchError('模型输出过程中发生错误，请重试。', 'MODEL_STREAM_ERROR');
    if (!chunk || !Array.isArray(chunk.choices))
      throw new WorkbenchError('模型流格式无效。', 'MODEL_INVALID_RESPONSE');
    if (chunk.usage) usage = chunk.usage;
    const choice = chunk.choices.find((item) => item.index === 0 || item.index === undefined);
    if (!choice) return;
    if (choice.finish_reason) finishReason = choice.finish_reason;
    const text = choice.delta?.content;
    if (text !== undefined && text !== null && typeof text !== 'string')
      throw new WorkbenchError('模型流未返回文本内容。', 'MODEL_INVALID_RESPONSE');
    if (text) {
      content += text;
      onContent?.(content);
    }
  };
  const line = (value) => {
    if (!value) dispatch();
    else if (value.startsWith('data:')) data.push(value.slice(5).replace(/^ /, ''));
  };
  const consume = (eof = false) => {
    for (;;) {
      const match = /\r\n|\r|\n/.exec(buffer);
      if (!match) break;
      if (!eof && match[0] === '\r' && match.index === buffer.length - 1) break;
      line(buffer.slice(0, match.index));
      buffer = buffer.slice(match.index + match[0].length);
    }
    if (eof && buffer) {
      line(buffer);
      buffer = '';
    }
    if (eof) dispatch();
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        consume(true);
        break;
      }
      size += value.length;
      if (size > 2000000)
        throw new WorkbenchError('模型响应过大，请缩小评审范围。', 'MODEL_OUTPUT_LIMIT');
      buffer += decoder.decode(value, { stream: true });
      consume();
      if (ended) break;
    }
    if (!ended || !['stop', 'end_turn'].includes(finishReason))
      throw new WorkbenchError('模型输出未完整结束，请重试或缩小评审范围。', 'MODEL_INCOMPLETE');
    return { choices: [{ finish_reason: finishReason, message: { content } }], usage };
  } finally {
    await reader.cancel().catch(() => {});
  }
}

module.exports = { readCompletionStream };
