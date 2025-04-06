export default class QueuedWebAudioPlayer {
    private audioContext: AudioContext | undefined;
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
    constructor() {}

    async enqueueAudio(audio: Blob) {
        // Chain this processing to the previous enqueue operation to ensure sequential processing
        this.enqueueProcessingPromise = this.enqueueProcessingPromise
            .then(async () => {
                console.log(`Processing new audio chunk`);
                if(!this.audioContext){
                    this.audioContext = new AudioContext();
                }
                const arrayBuffer = await audio.arrayBuffer();
                const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

                const source = this.audioContext.createBufferSource();
                source.buffer = audioBuffer;
                source.playbackRate.value = this.speed;
                source.connect(this.audioContext.destination);

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
        source.onended = () => {
            this.isAudioBufferPlaying = false;
            if(this.isPlaying){
                console.log(`source ended. playing next`);
                // Automatically play the next source if available
                this.playNext();
            }
        };
        source.start();
    }

    play() {
        this.stop();
        if(!this.audioContext){
            this.audioContext = new AudioContext();
        }
        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }
        this.hasMoreAudioChunks = true;
        this.isPlaying = true;
        // If there's queued audio and nothing is playing, start playback
        if (!this.isAudioBufferPlaying && this.sourceQueue.length > 0) {
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
    }
}
