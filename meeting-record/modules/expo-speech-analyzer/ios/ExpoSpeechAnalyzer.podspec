Pod::Spec.new do |s|
  s.name           = 'ExpoSpeechAnalyzer'
  s.version        = '1.0.0'
  s.summary        = 'iOS 26 SpeechAnalyzer on-device transcription for Expo'
  s.description    = 'On-device long-form speech transcription using Apple SpeechAnalyzer / SpeechTranscriber (iOS 26+).'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '15.1', :tvos => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
