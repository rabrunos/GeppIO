void window.geppioSurface.then(api => {
  let marks = 0
  api.onInvoke((endpoint, _value, caller) => {
    if (endpoint.kind === 'command') marks++
    return caller + ' · ' + marks
  })
  document.querySelector('button')!.onclick = () => {
    void api.emit({ kind: 'event', name: 'pulse', version: 1, provider: 'sample.board' }, 'Atualizado')
  }
  api.ready()
})
