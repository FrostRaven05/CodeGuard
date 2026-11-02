const http = require('node:http');

// Explicitly opt-in, loopback-only HTTP fixture. It never calls an external model.
async function startMockModel({ commitMessageDelayMs = 0, reviewChunkDelayMs = 0 } = {}) {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 1000000) {
          response.writeHead(413);
          response.end();
          return;
        }
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      requests.push(body);
      let content = 'OK — local fixture';
      if (body.messages?.some((item) => item.role === 'system')) {
        const input = JSON.parse(body.messages.find((item) => item.role === 'user').content);
        const local = input.scope?.startsWith('全部本地改动');
        const file = input.files[0];
        let line = 0,
          finding;
        for (const row of file.text.split('\n')) {
          const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(row);
          if (hunk) line = Number(hunk[1]);
          else if (line && row.startsWith('+') && row.slice(1).trim()) {
            finding = {
              priority: 'P2',
              category: 'correctness',
              title: '演示问题：核对新增行为',
              path: file.path,
              side: 'new',
              line,
              evidence: row.slice(1),
              trigger: '这是本机模拟服务生成的交互验收样例。',
              consequence: '用于核对定位与复制流程，不代表真实缺陷。',
              suggestion: '请连接自己的真实模型后重新评审。',
            };
            break;
          } else if (line && (row.startsWith('+') || row.startsWith(' '))) line++;
        }
        content = JSON.stringify({
          summary: '模拟模型响应，仅验证发送、展示和定位流程，不代表真实代码评审。',
          findings: finding ? [finding] : [],
          visuals: finding
            ? {
                changes: [
                  {
                    title: local ? '理解当前工作区的文件变化' : '新增本次提交的文件内容',
                    before: '此内容尚未包含在父版本中。',
                    after: local
                      ? '查看固定工作区快照，不改变本次提交内容。'
                      : '将所选暂存版本纳入本次提交；未暂存编辑保持独立。',
                    location: {
                      path: finding.path,
                      side: finding.side,
                      line: finding.line,
                      evidence: finding.evidence,
                    },
                  },
                ],
                flows: [
                  {
                    title: '固定版本的解释流程（本机模拟）',
                    nodes: [
                      {
                        id: 'input',
                        label: local ? '选择全部本地改动' : '选择本次提交内容',
                        kind: 'start',
                        location: null,
                      },
                      {
                        id: 'snapshot',
                        label: local ? '读取固定工作区快照' : '读取固定暂存版本',
                        kind: 'step',
                        location: {
                          path: finding.path,
                          side: finding.side,
                          line: finding.line,
                          evidence: finding.evidence,
                        },
                      },
                      {
                        id: 'result',
                        label: '展示解释与待核对的问题',
                        kind: 'end',
                        location: null,
                      },
                    ],
                    edges: [
                      { from: 'input', to: 'snapshot', label: '固定范围' },
                      { from: 'snapshot', to: 'result', label: '形成解释' },
                    ],
                  },
                ],
              }
            : { changes: [], flows: [] },
        });
        if (
          body.messages.some(
            (item) => item.role === 'system' && item.content.includes('提交信息助手'),
          )
        ) {
          if (commitMessageDelayMs)
            await new Promise((resolve) => setTimeout(resolve, commitMessageDelayMs));
          content = JSON.stringify({ message: '新增暂存版本内容\n\n记录本次提交的文件变化。' });
        }
      }
      if (body.stream) {
        response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        response.setHeader('Cache-Control', 'no-cache');
        response.flushHeaders();
        const send = (value) => response.write(`data: ${JSON.stringify(value)}\n\n`);
        send({ choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] });
        for (let offset = 0; offset < content.length; offset += 64) {
          if (response.destroyed) return;
          send({
            choices: [
              {
                index: 0,
                delta: { content: content.slice(offset, offset + 64) },
                finish_reason: null,
              },
            ],
          });
          if (reviewChunkDelayMs)
            await new Promise((resolve) => setTimeout(resolve, reviewChunkDelayMs));
        }
        send({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
        send({ choices: [], usage: { total_tokens: 0 } });
        response.end('data: [DONE]\n\n');
        return;
      }
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({
          choices: [{ finish_reason: 'stop', message: { content } }],
          usage: { total_tokens: 0 },
        }),
      );
    } catch {
      response.writeHead(400);
      response.end('{}');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  };
}

module.exports = { startMockModel };
