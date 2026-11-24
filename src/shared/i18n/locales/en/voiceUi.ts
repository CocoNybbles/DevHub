/** English texts (reference): namespace `voiceUi` */
const en = {
  // Model selection
  confirmDeleteModel: 'Really delete this model?',
  modelActive: 'active',
  modelInstalled: 'installed',
  modelDelete: 'delete',
  loadingEngine: 'Downloading speech recognition …',
  loadingModel: 'Downloading speech model …',
  activeButton: 'Active',
  useModel: 'Use this model',
  downloading: 'Downloading …',
  download: 'Download (~{size} MB)',

  // Setup dialog
  setupTitle: 'Set up voice control',
  setupLater: 'Later',
  setupIntro:
    'Voice control needs a speech model to be downloaded first. After that, recognition runs completely locally and offline; German and English are detected automatically.',
  setupHintBefore: 'Choose a model. You can switch or delete it later under ',
  setupHintAfter: '.',

  // Dictation
  dictationNotSetUp: 'Voice input is not set up yet (Settings → Speech model).',
  dictationRecording: 'Recording … click the microphone again to stop.',
  dictationMicUnavailable: 'Microphone not available: {error}',
  dictationProcessing: 'Converting to text …',
  dictationTooShort: 'Recording too short.',
  dictationNothing: 'Nothing understood.'
}

export default en
