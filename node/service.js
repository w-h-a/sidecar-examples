const { Resource } = require('@opentelemetry/resources');
const {
  BasicTracerProvider,
  BatchSpanProcessor,
} = require('@opentelemetry/sdk-trace-base');
const { ATTR_SERVICE_NAME } = require('@opentelemetry/semantic-conventions');
const { context, propagation, trace } = require('@opentelemetry/api');
const {
  OTLPTraceExporter,
} = require('@opentelemetry/exporter-trace-otlp-http');
const express = require('express');
const URL = require('url').URL;

const resource = new Resource({
  [ATTR_SERVICE_NAME]: `node.node`,
});

const processor = new BatchSpanProcessor(
  new OTLPTraceExporter({
    url: 'http://jaeger:4318/v1/traces',
  })
);

const tp = new BasicTracerProvider({ resource });

tp.addSpanProcessor(processor);

tp.register();

const tracer = trace.getTracer(`node.node`);

const app = express();

app.use(express.json());

const port = 3000;

const sidecarUrl = 'http://localhost:3501';

app.post('/node/neworder', async (req, res) => {
  const traceparent = req.headers['traceparent'];

  const parentCtx = propagation.extract(context.active(), { traceparent });

  const span = tracer.startSpan('node.Neworder', undefined, parentCtx);

  const carrier = { traceparent: '' };

  const ctx = trace.setSpan(context.active(), span);

  propagation.inject(ctx, carrier);

  console.log('raw req: ' + JSON.stringify(req.body));

  console.log('raw headers: ' + JSON.stringify(req.headers));

  const data = req.body.payload;

  const orderId = data.orderId;

  console.log('got a new order: ' + orderId);

  const records = [
    {
      key: orderId.toString(),
      value: data,
    },
  ];

  const url = new URL(`/state/orders`, sidecarUrl);

  span.setAttribute('url', url.href);

  console.log('traceparent', carrier.traceparent);

  const rsp = await fetch(url.href, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      traceparent: carrier.traceparent,
    },
    body: JSON.stringify(records),
  });

  if (rsp.ok) {
    console.log('successfully persisted state');
  } else {
    console.log('failed to persist state');
  }

  span.setStatus({ code: 1 });

  span.end();

  res.json({});
});

app.post('/node/b', async (req, res) => {
  console.log(`headers: ${JSON.stringify(req.headers)}`);

  const data = req.body.payload;

  console.log(`b: ${JSON.stringify(data)}`);

  res.json({});
});

app.get('/order', async (req, res) => {
  const url = new URL(`/state/orders`, sidecarUrl);

  const rsp = await fetch(url.href, {
    method: 'GET',
    headers: {
      'content-type': 'application/json',
    },
  });

  const body = await rsp.json();

  console.log(`we received this from sidecar: ${JSON.stringify(body)}`);

  res.json(body);
});

app.get('/order/:id', async (req, res) => {
  const id = req.params['id'];

  const url = new URL(`/state/orders/${id}`, sidecarUrl);

  const rsp = await fetch(url.href, {
    method: 'GET',
    headers: {
      'content-type': 'application/json',
    },
  });

  const body = await rsp.json();

  console.log(`we received this from sidecar: ${JSON.stringify(body)}`);

  if (rsp.status === 404) {
    res.status(404).json(body);
    return;
  }

  res.json(body);
});

app.delete('/order/:id', async (req, res) => {
  const id = req.params['id'];

  const url = new URL(`/state/orders/${id}`, sidecarUrl);

  await fetch(url.href, {
    method: 'DELETE',
    headers: {
      'content-type': 'application/json',
    },
  });

  res.json({});
});

app.get('/secret', async (req, res) => {
  const url = new URL(`/secret/ssm/mysecret`, sidecarUrl);

  const rsp = await fetch(url.href, {
    method: 'GET',
    headers: {
      'content-type': 'application/json',
    },
  });

  const body = await rsp.json();

  console.log(`we received this from sidecar: ${JSON.stringify(body)}`);

  res.json({
    mysecret: body.data['mysecret'],
  });
});

app.get('/trace', async (req, res) => {
  const url = new URL(`/health/trace`, sidecarUrl);

  const rsp = await fetch(url.href, {
    method: 'GET',
    headers: {
      'content-type': 'application/json',
    },
  });

  const body = await rsp.json();

  console.log(`we received this from sidecar: ${JSON.stringify(body)}`);

  res.json({
    spans: body,
  });
});

app.listen(port, () => {
  console.log(`node is listening on port ${port}`);
});
