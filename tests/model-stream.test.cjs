const test = require('node:test');
const assert = require('node:assert/strict');
const { callModel } = require('../electron/model-settings.cjs');
const { reviewStreamPreview } = require('../electron/review-stream-preview.cjs');

const connection = {
  endpoint: 'http://127.0.0.1/fixture',
  model: 'fixture',
  apiKey: 'fixture-key',
};
const event = (value) => `data: ${JSON.stringify(value)}\n\n`;
const delta = (content) => ({ choices: [{ index: 0, delta: { content }, finish_reason: null }] });
const stop = (reason = 'stop') => ({ choices: [{ index: 0, delta: {}, finish_reason: reason }] });
function streamResponse(text, chunkSize = 3) {
  const bytes = Buffer.from(text);
  let offset = 0;
  return new Response(
    new ReadableStream({
      pull(controller) {
        if (offset >= bytes.length) return controller.close();
        controller.enqueue(bytes.subarray(offset, (offset += chunkSize)));
      },
    }),
    { headers: { 'content-type': 'text/event-stream; charset=utf-8' } },
  );
}
const requestStream = (text, options = {}) =>
  callModel(connection, [{ role: 'user', content: 'fixture' }], {
    stream: true,
    fetchImpl: async () => streamResponse(text),
    ...options,
  });

test('SSE 跨字节中文、CRLF、注释、多 data 行与末尾用量合并为完整结果', async () => {
  const previews = [];
  let request;
  const wire =
    ': keepalive\r\nevent: message\r\n' +
    'data: {"choices": [\r\ndata: {"index":0,"delta":{"role":"assistant"}}]}\r\n\r\n' +
    event(delta('中文摘要，')).replaceAll('\n', '\r\n') +
    event({ choices: [{ index: 1, delta: { content: '忽略其他选择' } }] }) +
    event({ choices: [{ index: 0, delta: { reasoning_content: '内部推理不展示' } }] }) +
    event(delta('继续输出。')) +
    event(stop()) +
    event({ choices: [], usage: { prompt_tokens: 4, completion_tokens: 6, total_tokens: 10 } }) +
    'data: [DONE]\r\n\r\n';
  const result = await requestStream(wire, {
    fetchImpl: async (_url, options) => {
      request = JSON.parse(options.body);
      return streamResponse(wire, 1);
    },
    onContent: (content) => previews.push(content),
  });
  assert.equal(request.stream, true);
  assert.deepEqual(request.stream_options, { include_usage: true });
  assert.equal(result.content, '中文摘要，继续输出。');
  assert.equal(previews[0], '中文摘要，');
  assert.ok(previews.every((text) => !text.includes('推理') && !text.includes('其他选择')));
  assert.deepEqual(result.usage, { promptTokens: 4, completionTokens: 6, totalTokens: 10 });
});

test('流式请求兼容整包 JSON，缺失用量保持未知且密钥被隐藏', async () => {
  const previews = [];
  const result = await callModel(connection, [], {
    stream: true,
    fetchImpl: async () =>
      Response.json({
        choices: [{ message: { content: 'fixture-key 完成' }, finish_reason: 'stop' }],
      }),
    onContent: (text) => previews.push(text),
  });
  assert.equal(result.content, '[密钥已隐藏] 完成');
  assert.deepEqual(previews, [result.content]);
  assert.equal(result.totalTokens, null);
});

test('长思考流的协议开销不冒充正文过大，最终短结果可完成', async () => {
  const reasoning = event({
    id: 'fixture-completion',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'fixture',
    choices: [{ index: 0, delta: { reasoning_content: '隐藏' }, finish_reason: null }],
  });
  const wire =
    reasoning.repeat(Math.ceil(2100000 / Buffer.byteLength(reasoning))) +
    event(delta('完成')) +
    event(stop()) +
    'data: [DONE]\n\n';
  const previews = [];
  const reasoningActivity = [];
  const result = await requestStream(wire, {
    fetchImpl: async () => streamResponse(wire, 65536),
    onContent: (text) => previews.push(text),
    onReasoning: (...args) => reasoningActivity.push(args),
  });
  assert.equal(result.content, '完成');
  assert.ok(previews.every((text) => !text.includes('隐藏')));
  assert.ok(reasoningActivity.length > 0);
  assert.ok(reasoningActivity.every((args) => args.length === 0));
});

test('断流、截断、错误事件和无效数据不冒充完成，服务错误原文不外泄', async (t) => {
  for (const [name, wire, code] of [
    ['missing-done', event(delta('partial')) + event(stop()), 'MODEL_INCOMPLETE'],
    ['missing-finish', event(delta('partial')) + 'data: [DONE]\n\n', 'MODEL_INCOMPLETE'],
    [
      'length',
      event(delta('partial')) + event(stop('length')) + 'data: [DONE]\n\n',
      'MODEL_INCOMPLETE',
    ],
    ['invalid-json', 'data: invalid\n\n', 'MODEL_INVALID_RESPONSE'],
    ['error', event({ error: { message: 'fixture-key private response' } }), 'MODEL_STREAM_ERROR'],
    ['nontext', event(delta({ type: 'text' })), 'MODEL_INVALID_RESPONSE'],
    [
      'reasoning-only',
      event({ choices: [{ index: 0, delta: { reasoning_content: 'hidden' } }] }) +
        event(stop()) +
        'data: [DONE]\n\n',
      'MODEL_INVALID_RESPONSE',
    ],
  ])
    await t.test(name, async () => {
      await assert.rejects(requestStream(wire), (error) => {
        assert.equal(error.code, code);
        assert.ok(!error.message.includes('fixture-key'));
        return true;
      });
    });
});

test('SSE 响应超出字节上限会停止读取', async () => {
  const wire = (': ' + 'x'.repeat(1000) + '\n\n').repeat(16000);
  await assert.rejects(
    requestStream(wire, { fetchImpl: async () => streamResponse(wire, 65536) }),
    { code: 'MODEL_OUTPUT_LIMIT' },
  );
});

test('SSE 正文仍受字节上限限制，单事件和未分隔事件保持有界', async (t) => {
  const oversizedText = event(delta('文'.repeat(1000))).repeat(667);
  for (const [name, wire] of [
    ['content', oversizedText],
    ['single-line', 'data: ' + 'x'.repeat(2000001)],
    ['multi-line-event', ('data: ' + 'x'.repeat(1000) + '\n').repeat(2000)],
  ])
    await t.test(name, async () => {
      await assert.rejects(
        requestStream(wire, {
          fetchImpl: async () => streamResponse(wire, 65536),
        }),
        { code: 'MODEL_OUTPUT_LIMIT' },
      );
    });
});

test('未完成 JSON 只提取完整的顶层摘要和问题，不混入嵌套字段、字符串片段', () => {
  const finding = { title: '带有 } 和 \\" 的标题', nested: { findings: [1] } };
  const prefix = '{"other":{"summary":"不能冒充顶层摘要"},"summary":"中文\\n摘要","findings":[';
  assert.deepEqual(reviewStreamPreview(prefix + JSON.stringify(finding) + ',{"title":"未完成'), {
    summary: '中文\n摘要',
    findings: [finding],
  });
  assert.deepEqual(reviewStreamPreview('{"summary":"password = \\"unfinished-private'), {
    summary: '',
    findings: [],
  });
  assert.deepEqual(reviewStreamPreview('```json\n{"findings":[],"summary":"后置摘要"}\n```'), {
    summary: '后置摘要',
    findings: [],
  });
  assert.deepEqual(reviewStreamPreview('{"summary":"bad\\q"'), { summary: '', findings: [] });
});
