void window.geppioSurface.then(api => {
  const output = document.querySelector('output')!
  api.onEvent((_endpoint, value) => { output.value = value })
  document.querySelector('button')!.onclick = async () => {
    const response = await api.call({ provider: 'sample.board', kind: 'service', name: 'title', version: 1 }, '')
    output.value = response.ok ? response.value : response.error
  }
  api.ready()
})
