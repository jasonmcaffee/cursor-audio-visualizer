'use client';

import { FaMicrophone } from 'react-icons/fa';
import { useState, useEffect } from 'react';
import styles from './page.module.css';
import LoudnessMeter from './components/LoudnessMeter';
import CallbackCounters from './components/CallbackCounters';
import AudioLoudnessMeter from './services/AudioLoudnessMeter';

export default function Home() {
  const [isRecording, setIsRecording] = useState(false);
  const [currentVolume, setCurrentVolume] = useState(0);
  const [volumeInfoCount, setVolumeInfoCount] = useState(0);
  const [audioAboveThresholdCount, setAudioAboveThresholdCount] = useState(0);
  const [silenceDetectedCount, setSilenceDetectedCount] = useState(0);
  const [audioMeter, setAudioMeter] = useState<AudioLoudnessMeter | null>(null);

  useEffect(() => {
    return () => {
      if (audioMeter) {
        audioMeter.stop();
      }
    };
  }, [audioMeter]);

  const handleRecordClick = async () => {
    if (isRecording) {
      audioMeter?.stop();
      setIsRecording(false);
      return;
    }

    const meter = new AudioLoudnessMeter();
    setAudioMeter(meter);

    try {
      await meter.start({
        onPeriodicVolumeInformation: (volume: number) => {
          setCurrentVolume(volume);
          setVolumeInfoCount(prev => prev + 1);
        },
        onAudioAboveThresholdDetected: () => {
          setAudioAboveThresholdCount(prev => prev + 1);
        },
        onSilenceDetected: () => {
          setSilenceDetectedCount(prev => prev + 1);
        },
      });
      setIsRecording(true);
    } catch (error) {
      console.error('Error starting audio meter:', error);
    }
  };

  return (
    <main className={styles.container}>
      <button 
        className={`${styles.recordButton} ${isRecording ? styles.recording : ''}`}
        onClick={handleRecordClick}
      >
        <FaMicrophone />
        {isRecording ? 'Stop Recording' : 'Record'}
      </button>

      {isRecording && (
        <>
          <LoudnessMeter volume={currentVolume} />
          <CallbackCounters
            volumeInfoCount={volumeInfoCount}
            audioAboveThresholdCount={audioAboveThresholdCount}
            silenceDetectedCount={silenceDetectedCount}
          />
        </>
      )}
    </main>
  );
}
