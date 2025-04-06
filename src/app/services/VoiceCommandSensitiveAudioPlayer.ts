import QueuedWebAudioPlayer from "./QueuedWebAudioPlayer";
import AudioLoudnessMeter from "./AudioLoudnessMeter";
/**
 * Listen for voice commands from the user by monitoring audio loudness via the AudioLoudnessMeter.
 * Plays audio using WebAudioPlayer. 
 * When loudness from the microphone is detected, this class will lower the volume of the audio player for N ms, so that the user can speak 
 * without having the audio interfere. 
 */
export default class VoiceCommandSensitiveAudioPlayer {
    
    private config = {
        loudnessThreshold: 5,
        preTriggerBufferDuration: 20,
        initialRecordingDuration: 1000,
        volumeCheckInterval: 50,
        fftSize: 1024,
        currentMimeType: 'audio/webm;codecs=opus',
        audioPlayerVolume: 1.0,
    
    };

    constructor(
        private queuedWebAudioPlayer: QueuedWebAudioPlayer = new QueuedWebAudioPlayer(), 
        private audioLoudnessMeter: AudioLoudnessMeter = new AudioLoudnessMeter(),
        config?: Partial<typeof VoiceCommandSensitiveAudioPlayer.prototype.config>
    ) {
        if (config) {
            this.config = { ...this.config, ...config };
        }
    }

    async enqueueAudio(audioBlob: Blob): Promise<void> {
        this.queuedWebAudioPlayer.enqueueAudio(audioBlob);
    }

    
    private async handleLoudnessDetected(audioBlob: Blob) {
        this.queuedWebAudioPlayer.setVolume(0.5);
        await this.queuedWebAudioPlayer.enqueueAudio(audioBlob);
    }

    private handleSilenceDetected(audioBlob: Blob) {
        console.log('silence detected. setting volume back to normal');
        this.queuedWebAudioPlayer.setVolume(this.config.audioPlayerVolume);
        this.queuedWebAudioPlayer.enqueueAudio(audioBlob);
    }   
    
    private handlePeriodicVolumeInformation(volume: number): void {
        if(volume > this.config.loudnessThreshold){
            //todo: pause audio for 1 second.  use setTimeout and clearInterval to reset if the volume is still above threshold
        }
    }

    async startAudioLoudnessMeter() {
        await this.audioLoudnessMeter.start({
            onPeriodicVolumeInformation: (volume: number) => {
                this.handlePeriodicVolumeInformation(volume);
            },
            onAudioAboveThresholdDetected: async (audioBlob: Blob) => {
                this.handleLoudnessDetected(audioBlob);
            },
            onSilenceDetected: async (audioBlob: Blob) => {
              this.handleSilenceDetected(audioBlob);
            },
        });
    }

    stopAudioLoudnessMeter(): void {
        this.audioLoudnessMeter.stop();
    }   
    
}