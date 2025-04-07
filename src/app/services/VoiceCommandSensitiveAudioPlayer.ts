import QueuedWebAudioPlayer from "./QueuedWebAudioPlayer";
import AudioLoudnessMeter from "./AudioLoudnessMeter";
import WebAudioPlayer from "./WebAudioPlayer";
/**
 * Listen for voice commands from the user by monitoring audio loudness via the AudioLoudnessMeter.
 * Plays audio using WebAudioPlayer. 
 * When loudness from the microphone is detected, this class will lower the volume of the audio player for N ms, so that the user can speak 
 * without having the audio interfere. 
 */
export default class VoiceCommandSensitiveAudioPlayer {
    
    private config = {
        loudnessThreshold: 10,
        preTriggerBufferDuration: 20,
        initialRecordingDuration: 1000,
        volumeCheckInterval: 50,
        fftSize: 1024,
        currentMimeType: 'audio/webm;codecs=opus',
        audioPlayerVolume: 1.0,
        echoCancellation: true, //removes audio from speakers.
        noiseSuppression: true, //Constant sounds like fans, keyboard clacking, air conditioning hum, etc.
        autoGainControl: true, //If you're speaking quietly → it will boost your voice.
    };

    private pauseDueToAudioLoundessThresholdExceededIntervalId: number | undefined;
    private audioLoudnessMeter: AudioLoudnessMeter;

    constructor(
        private queuedWebAudioPlayer: QueuedWebAudioPlayer = new QueuedWebAudioPlayer(), 
        private webAudioPlayer: WebAudioPlayer = new WebAudioPlayer(),
        config?: Partial<typeof VoiceCommandSensitiveAudioPlayer.prototype.config>
    ) {
        if (config) {
            this.config = { ...this.config, ...config };
        }
        this.audioLoudnessMeter = new AudioLoudnessMeter({
            echoCancellation: this.config.echoCancellation, 
            noiseSuppression: this.config.noiseSuppression, 
            autoGainControl: this.config.autoGainControl,
            loudnessThreshold: this.config.loudnessThreshold,
            preTriggerBufferDuration: this.config.preTriggerBufferDuration,
            initialRecordingDuration: this.config.initialRecordingDuration,
            volumeCheckInterval: this.config.volumeCheckInterval,
            fftSize: this.config.fftSize,
            currentMimeType: this.config.currentMimeType,
        });
        this.playEnqueuedAudio();
    }

    async enqueueAudio(audioBlob: Blob) {
        this.queuedWebAudioPlayer.enqueueAudio(audioBlob);
    }

    async playEnqueuedAudio(){
        this.queuedWebAudioPlayer.play();
    }

    async pauseEnqueuedAudio(){
        this.queuedWebAudioPlayer.pause();
    }   

    private async handleLoudnessDetected(audioBlob: Blob) {
        console.log('loudness detected. playing audio');
        // this.queuedWebAudioPlayer.setVolume(0.5);
        // await this.queuedWebAudioPlayer.enqueueAudio(audioBlob);
        this.webAudioPlayer.playAudioBlob(audioBlob);
    }

    private handleSilenceDetected(audioBlob: Blob) {
        console.log('silence detected. setting volume back to normal');
        this.queuedWebAudioPlayer.setVolume(this.config.audioPlayerVolume);
        // this.queuedWebAudioPlayer.enqueueAudio(audioBlob);
        this.webAudioPlayer.playAudioBlob(audioBlob);
    }   
    
    private handlePeriodicVolumeInformation(volume: number): void {
        if(volume > this.config.loudnessThreshold && this.queuedWebAudioPlayer.isPlaying){
            console.log('volume above threshold. pausing audio');
            this.queuedWebAudioPlayer.pause();
            //todo: pause audio for 1 second.  use setTimeout and clearInterval to reset if the volume is still above threshold
            clearInterval(this.pauseDueToAudioLoundessThresholdExceededIntervalId);
            //@ts-ignore
            this.pauseDueToAudioLoundessThresholdExceededIntervalId = setTimeout(() => {
                this.queuedWebAudioPlayer.play();
            }, 5000);
        }
    }

    async startListening({onPeriodicVolumeInformation, onAudioAboveThresholdDetected, onSilenceDetected}: {
        onPeriodicVolumeInformation: (volume: number) => void, onAudioAboveThresholdDetected: (audioBlob: Blob) => void, onSilenceDetected: (audioBlob: Blob) => void
    }) {
        await this.audioLoudnessMeter.start({
            onPeriodicVolumeInformation: (volume: number) => {
                this.handlePeriodicVolumeInformation(volume);
                onPeriodicVolumeInformation(volume);
            },
            onAudioAboveThresholdDetected: async (audioBlob: Blob) => {
                this.handleLoudnessDetected(audioBlob);
                onAudioAboveThresholdDetected(audioBlob);   
            },
            onSilenceDetected: async (audioBlob: Blob) => {
              this.handleSilenceDetected(audioBlob);
              onSilenceDetected(audioBlob);
            },
        });
    }

    stopListening(): void {
        this.audioLoudnessMeter.stop();
    }   
    
}