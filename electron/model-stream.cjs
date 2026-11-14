const { WorkbenchError } = require('./git-service.cjs');

// Decode SSE lines independently of TCP/UTF-8 chunk boundaries.
async function readCompletionStream(reader, onContent, onReasoning) {
  const decoder = new TextDecoder();
  let buffer = '',
    data = [],
    content = '',
    usage,
    finishReason,
    ended = false,
    size = 0,
    eventSize = 0,
    contentSize = 0;
  const dispatch = () => {
    if (!data.length) return;
    const payload = data.join('\n');
    data = [];
    eventSize = 0;
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
    // Report activity only. Reasoning stays out of previews, results and logs.
    if (typeof choice.delta?.reasoning_content === 'string' && choice.delta.reasoning_content)
      onReasoning?.();
    const text = choice.delta?.content;
    if (text !== undefined && text !== null && typeof text !== 'string')
      throw new WorkbenchError('模型流未返回文本内容。', 'MODEL_INVALID_RESPONSE');
    if (text) {
      contentSize += Buffer.byteLength(text, 'utf8');
      if (contentSize > 2000000)
        throw new WorkbenchError('模型正文过大，请缩小评审范围。', 'MODEL_OUTPUT_LIMIT');
      content += text;
      onContent?.(content);
    }
  };
  const line = (value) => {
    if (!value) dispatch();
    else if (value.startsWith('data:')) {
      eventSize += value.length;
      if (eventSize > 2000000)
        throw new WorkbenchError('模型流事件过大，已停止接收。', 'MODEL_OUTPUT_LIMIT');
      data.push(value.slice(5).replace(/^ /, ''));
    }
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
      // Token-by-token SSE repeats metadata (including for hidden reasoning).
      // Bound wire traffic separately from the much smaller final answer.
      if (size > 16000000)
        throw new WorkbenchError('模型流传输量超过上限，已停止接收。', 'MODEL_OUTPUT_LIMIT');
      buffer += decoder.decode(value, { stream: true });
      consume();
      if (buffer.length > 2000000)
        throw new WorkbenchError('模型流事件过大，已停止接收。', 'MODEL_OUTPUT_LIMIT');
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
