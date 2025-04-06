import WebAudioPlayer from "./WebAudioPlayer";
import AudioLoudnessMeter from "./AudioLoudnessMeter";
/**
 * Listen for voice commands from the user by monitoring audio loudness via the AudioLoudnessMeter.
 * Plays audio using WebAudioPlayer. 
 * When loudness from the microphone is detected, this class will lower the volume of the audio player for N ms, so that the user can speak 
 * without having the audio interfere. 
 */
export default class VoiceCommandSensitiveAudioPlayer {
    private audioPlayer: WebAudioPlayer;
    private meter: AudioLoudnessMeter;
    private config = {
        loudnessThreshold: 5,
        preTriggerBufferDuration: 20,
        initialRecordingDuration: 1000,
        volumeCheckInterval: 50,
        fftSize: 1024,
        currentMimeType: 'audio/webm;codecs=opus',
        audioPlayerVolume: 1.0,
        duckingFactor: 0.5,
    }

    async playAudioFile(filePath: string): Promise<void> {
        this.audioPlayer.playAudioFile(filePath);
    }
    async playAudioBlob(audioBlob: Blob): Promise<void> {
        this.audioPlayer.playAudioBlob(audioBlob);
    }

    async startListening(): Promise<void> {
        this.meter.start();
    }

    async stopListening(): Promise<void> {
        this.meter.stop();
    }
    
    private handleLoudnessDetected(): void {
        this.audioPlayer.setVolume(0.5);
    }

    private handleSilenceDetected(): void {
        this.audioPlayer.setVolume(this.config.audioPlayerVolume);
    }   
    
    
}