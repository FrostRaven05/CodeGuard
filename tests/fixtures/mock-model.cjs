const http = require('node:http');

// Explicitly opt-in, loopback-only HTTP fixture. It never calls an external model.
async function startMockModel() {
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
        });
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
