import AVFoundation

// 移植自 nyannyn/ios-voice-agent。

extension AVAudioPCMBuffer {
    /// 深拷貝一份 PCM buffer。
    ///
    /// AVAudioEngine 的 tap callback 在返回後會重用同一塊 buffer，所以要把音訊資料
    /// 丟到別的 thread（寫檔 / 格式轉換）前，必須先複製一份，否則會讀到被覆寫的資料。
    func deepCopy() -> AVAudioPCMBuffer? {
        guard let copy = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCapacity) else {
            return nil
        }
        copy.frameLength = frameLength
        let channels = Int(format.channelCount)
        let frames = Int(frameLength)

        if let src = floatChannelData, let dst = copy.floatChannelData {
            for ch in 0..<channels {
                memcpy(dst[ch], src[ch], frames * MemoryLayout<Float>.size)
            }
        } else if let src = int16ChannelData, let dst = copy.int16ChannelData {
            for ch in 0..<channels {
                memcpy(dst[ch], src[ch], frames * MemoryLayout<Int16>.size)
            }
        } else if let src = int32ChannelData, let dst = copy.int32ChannelData {
            for ch in 0..<channels {
                memcpy(dst[ch], src[ch], frames * MemoryLayout<Int32>.size)
            }
        } else {
            return nil
        }
        return copy
    }
}
