
export function calculateLoudness(analyser: AnalyserNode | null) {
    if (!analyser) {
        return 0;
    }
    const bufferLength = analyser!.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);

    let sum = 0;
    for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
    }
    const averageLoudness = sum / bufferLength;
    const normalizedLoudness = (averageLoudness / 255) * 100;
    return normalizedLoudness;
}

export function createAudioContext() {
    return new (window.AudioContext || ((window as unknown) as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
}
