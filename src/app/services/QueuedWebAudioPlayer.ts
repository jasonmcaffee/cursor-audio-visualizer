export default class QueuedWebAudioPlayer {
    private audioContext: AudioContext | undefined;
    private gainNode: GainNode | undefined;
    // sourceQueue holds decoded audio sources waiting to be played
    private sourceQueue: AudioBufferSourceNode[] = [];
    private currentSource: AudioBufferSourceNode | undefined;
    // isPlaying indicates whether a source is actively playing
    public isAudioBufferPlaying: boolean = false;
    // isPlaying indicates whether the user has initiated playback via start()
    public isPlaying: boolean = false;
    private speed: number = 1.0;
    private hasMoreAudioChunks: boolean = true;
    private enqueueProcessingPromise: Promise<void> = Promise.resolve();
    // Track playback position for pause/resume
    private playbackPosition: number = 0;
    private lastPauseTime: number = 0;
    private totalElapsedTime: number = 0;
    private currentBuffer: AudioBuffer | null = null;

    constructor() {
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        this.gainNode = this.audioContext.createGain();
        this.gainNode.connect(this.audioContext.destination);
    }

    setVolume(volume: number): void {
        if (this.gainNode) {
            this.gainNode.gain.value = volume;
        }
    }

    async enqueueAudio(audio: Blob) {
        // Chain this processing to the previous enqueue operation to ensure sequential processing
        this.enqueueProcessingPromise = this.enqueueProcessingPromise
            .then(async () => {
                // console.log(`Processing new audio chunk`);
                if(!this.audioContext){
                    this.audioContext = new AudioContext();
                    this.gainNode = this.audioContext.createGain();
                    this.gainNode.connect(this.audioContext.destination);
                }
                const arrayBuffer = await audio.arrayBuffer();
                const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

                const source = this.audioContext.createBufferSource();
                source.buffer = audioBuffer;
                source.playbackRate.value = this.speed;
                source.connect(this.gainNode!);

                this.sourceQueue.push(source);
                // If the player has been started and nothing is currently playing,
                // immediately start playback for the new audio.
                if (this.isPlaying && !this.isAudioBufferPlaying) {
                    this.playNext();
                }
            })
            .catch(error => {
                console.error("Error processing audio:", error);
            });

        // Return the promise - caller can await if needed but doesn't have to
        return this.enqueueProcessingPromise;
    }

    private playNext() {
        if(!this.hasMoreAudioChunks && this.sourceQueue.length === 0){
            this.stop();
            return;
        }
        // If nothing is queued, simply exit (but remain in a 'started' state)
        if (this.sourceQueue.length === 0) {
            this.isAudioBufferPlaying = false;
            return;
        }

        const source = this.sourceQueue.shift();
        this.currentSource = source;
        if (!source) {
            this.isAudioBufferPlaying = false;
            return;
        }

        this.isAudioBufferPlaying = true;
        this.currentBuffer = source.buffer;
        this.lastPauseTime = this.audioContext!.currentTime;
        
        source.onended = () => {
            this.isAudioBufferPlaying = false;
            this.playbackPosition = 0;
            this.totalElapsedTime = 0;
            if(this.isPlaying){
                console.log(`source ended. playing next`);
                // Automatically play the next source if available
                this.playNext();
            }
        };
        source.start(0, this.playbackPosition);
    }

    pause() {
        if (!this.isAudioBufferPlaying || !this.currentSource || !this.audioContext) {
            // console.log('pause() called but isAudioBufferPlaying is false or currentSource is undefined or audioContext is undefined');
            return;
        }

        // Calculate the current playback position
        const currentTime = this.audioContext.currentTime;
        const elapsedSinceLastPause = currentTime - this.lastPauseTime;
        this.totalElapsedTime += elapsedSinceLastPause;
        this.playbackPosition = this.totalElapsedTime;
        
        // Stop the current source
        this.currentSource.onended = null;
        this.currentSource.stop();
        this.currentSource.disconnect();
        this.isAudioBufferPlaying = false;
    }

    play() {
        // console.log('play() called isAudioBufferPlaying currentBuffer playbackPosition', this.isAudioBufferPlaying, this.currentBuffer, this.playbackPosition);
        if (this.isAudioBufferPlaying) {
            return;
        }

        if(!this.audioContext){
            this.audioContext = new AudioContext();
            this.gainNode = this.audioContext.createGain();
            this.gainNode.connect(this.audioContext.destination);
        }
        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }
        this.hasMoreAudioChunks = true;
        this.isPlaying = true;
        
        // If we have a current buffer and playback position, create a new source
        if (this.currentBuffer && this.playbackPosition > 0) {
            const source = this.audioContext.createBufferSource();
            source.buffer = this.currentBuffer;
            source.playbackRate.value = this.speed;
            source.connect(this.gainNode!);
            this.currentSource = source;
            this.isAudioBufferPlaying = true;
            this.lastPauseTime = this.audioContext.currentTime;
            
            source.onended = () => {
                this.isAudioBufferPlaying = false;
                this.playbackPosition = 0;
                this.totalElapsedTime = 0;
                if(this.isPlaying){
                    this.playNext();
                }
            };
            source.start(0, this.playbackPosition);
        } else if (!this.isAudioBufferPlaying && this.sourceQueue.length > 0) {
            this.playNext();
        }
    }

    noMoreAudioChunksWillBeReceived(){
        console.log(`noMoreAudioChunksWillBeReceived`);
        this.hasMoreAudioChunks = false;
    }

    stop() {
        console.log(`stopping...`);
        // Stop any currently playing source and clear the queue
        this.sourceQueue.forEach(source => {
            try{
                console.log(`stopping source.`);
                source.onended = ()=> {};
                source.disconnect();
                source.stop();
            }catch(e){
                // console.error(`cant stop source: `, e);
            }
        });
        try{
            if(this.currentSource){
                this.currentSource.onended = ()=> {};
                this.currentSource?.disconnect();
                this.currentSource?.stop();
            }
        }catch(e){
            console.error(`cant stop current source: `, e);
        }
        try{
            this.audioContext?.suspend();
        }catch(e){

        }
        this.currentSource = undefined;
        this.sourceQueue = [];
        this.isAudioBufferPlaying = false;
        this.isPlaying = false;
        this.playbackPosition = 0;
        this.totalElapsedTime = 0;
        this.currentBuffer = null;
    }

    dispose(): void {
        this.stop();
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = undefined;
        }
    }
}
