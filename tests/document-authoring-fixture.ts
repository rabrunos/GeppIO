function unexpected(): never { throw new Error('Unexpected document authoring operation') }
export const unusedDocumentAuthoring = { create: unexpected, saveAs: unexpected, saveAll: unexpected }
