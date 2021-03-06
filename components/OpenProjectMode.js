const noflo = require('noflo');
const { getGraphType, getComponentType, getRemoteNodes } = require('../src/runtime');

const sendGraphs = function(client, graphs, currentGraphs) {
  const compatible = graphs.filter(g => getGraphType(g) === client.definition.type);
  return Promise.all(compatible.map(function(g) {
    const main = g === currentGraphs[0] ? true : false;
    return client.protocol.graph.send(g, main);
  }));
};

const sendComponents = function(client, components, namespace) {
  const compatible = components.filter(function(c) { let needle;
  return (needle = getComponentType(c), [null, client.definition.type].includes(needle)); });
  return Promise.all(compatible.map(c => client.protocol.component.source({
    name: c.name,
    language: c.language,
    library: namespace || client.definition.namespace,
    code: c.code
  }) ));
};

// Scope iframe runtimes to project
const ensureIframe = function(client, project) {
  client.definition.querySelector = `iframe[data-runtime='${client.definition.id}'][data-project='${project.id}']`;
  let iframe = document.body.querySelector(client.definition.querySelector);
  if (!iframe) {
    // No iframe for this runtime/project combination yet, create
    iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');
    iframe.setAttribute('data-runtime', client.definition.id);
    iframe.setAttribute('data-project', project.id);
    iframe.className = 'iframe-runtime';
    document.body.appendChild(iframe);
  }
  if (!client.transport.iframe) {
    // Client has not been connected yet
    client.transport.iframe = iframe;
    return Promise.resolve();
  }
  if (client.transport.iframe === iframe) {
    // We were already connected to this one
    return Promise.resolve();
  }
  // We were connected to another iframe
  // Disconnect and set new
  return client.disconnect()
    .then(function() {
      client.transport.iframe = iframe;
      return Promise.resolve();
    });
};

exports.getComponent = function() {
  const c = new noflo.Component;
  c.inPorts.add('in',
    {datatype: 'object'});
  c.inPorts.add('client',
    {datatype: 'object'});
  c.outPorts.add('out',
    {datatype: 'object'});
  c.outPorts.add('error',
    {datatype: 'object'});

  return c.process(function(input, output) {
    if (!input.hasData('in', 'client')) { return; }
    const [route, client] = Array.from(input.getData('in', 'client'));

    if (route.remote != null ? route.remote.length : undefined) {
      // We need to fetch components from runtime, send "loading"
      route.state = 'loading';
    }
    // Send initial state
    output.send({
      out: route});

    return Promise.resolve()
      .then(function() {
        if (client.definition.protocol !== 'iframe') {
          return Promise.resolve();
        }
        return ensureIframe(client, route.project);
      })
      .then(() => client.connect())
      .then(() => sendComponents(client, route.project.components, route.project.namespace))
      .then(() => sendGraphs(client, route.project.graphs, route.graphs))
      .then(function() {
        if (!(route.graphs != null ? route.graphs.length : undefined)) {
          return Promise.resolve();
        }
        if (client.transport.graph === route.graphs[0]) {
          return Promise.resolve();
        }
        client.transport.setMain(route.graphs[0]);
        return Promise.resolve();
      })
      .then(() => getRemoteNodes(client, route))
      .then(function() {
        if (route.state !== 'loading') { return Promise.resolve(); }
        // We fetched things from runtime, update state
        route.state = 'ok';
        return output.send({
          out: route});
      })
      .then((() => output.done()), err => output.done(err));
  });
};
