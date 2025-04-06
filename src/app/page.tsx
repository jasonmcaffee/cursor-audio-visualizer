'use client';

import { FaMicrophone, FaPlay, FaPause } from 'react-icons/fa';
import { useState, useEffect } from 'react';
import styles from './page.module.css';
import LoudnessMeter from './components/LoudnessMeter';
import CallbackCounters from './components/CallbackCounters';
import AudioLoudnessMeter from './services/AudioLoudnessMeter';
import QueuedWebAudioPlayer from './services/QueuedWebAudioPlayer';
import WebAudioPlayer from './services/WebAudioPlayer';

const webAudioPlayer = new WebAudioPlayer();
const queuedWebAudioPlayer = new QueuedWebAudioPlayer();
const audioLoudnessMeter = new AudioLoudnessMeter();
queuedWebAudioPlayer.play();

export default function Home() {
  const [isRecording, setIsRecording] = useState(false);
  const [currentVolume, setCurrentVolume] = useState(0);
  const [volumeInfoCount, setVolumeInfoCount] = useState(0);
  const [audioAboveThresholdCount, setAudioAboveThresholdCount] = useState(0);
  const [silenceDetectedCount, setSilenceDetectedCount] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const baselineVolume = 1.0; // Maximum volume


  // Update volume when currentVolume changes and we're playing
  useEffect(() => {
    if (isPlaying && webAudioPlayer) {
      // const newVolume = Math.max(0, baselineVolume - currentVolume);
      // audioPlayer.setVolume(newVolume);
    }
  }, [currentVolume, isPlaying]);

  const handlePlayClick = async () => {
    if (!webAudioPlayer) return;
    if (isPlaying) {
      webAudioPlayer.stop();
    } else {
      try {
        webAudioPlayer.setVolume(baselineVolume);
        await webAudioPlayer.playAudioFile('sounds/Alan Watts - Buddhism Religion of No Religion  1.mp3');
       
      } catch (error) {
        console.error('Error playing audio file:', error);
      }
    }
    setIsPlaying(!isPlaying);
  };

  const handleRecordClick = async () => {
    if (isRecording) {
      audioLoudnessMeter?.stop();
      setIsRecording(false);
      return;
    }


    try {
      await audioLoudnessMeter.start({
        onPeriodicVolumeInformation: (volume: number) => {
          setCurrentVolume(volume);
          setVolumeInfoCount(prev => prev + 1);
        },
        onAudioAboveThresholdDetected: async (audioBlob: Blob) => {
          setAudioAboveThresholdCount(prev => prev + 1);
          try {
            console.log('audio above threshold detected');
            await queuedWebAudioPlayer.enqueueAudio(audioBlob);
            
          } catch (error) {
            console.error('Error playing audio:', error);
          }
        },
        onSilenceDetected: async (audioBlob: Blob) => {
          console.log('silence detected');
          await queuedWebAudioPlayer.enqueueAudio(audioBlob);
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
        className={`${styles.playButton} ${isPlaying ? styles.playing : ''}`}
        onClick={handlePlayClick}
      >
        {isPlaying ? <FaPause /> : <FaPlay />}
        {isPlaying ? 'Pause' : 'Play Alan Watts'}
      </button>

      <button 
        className={`${styles.recordButton} ${isRecording ? styles.recording : ''}`}
        onClick={handleRecordClick}
      >
        <FaMicrophone />
        {isRecording ? 'Stop Recording' : 'Record'}
      </button>

      {/* do not check if it is recording. always display */}
      <LoudnessMeter volume={currentVolume} />
      <CallbackCounters
        volumeInfoCount={volumeInfoCount}
        audioAboveThresholdCount={audioAboveThresholdCount}
        silenceDetectedCount={silenceDetectedCount}
      />
    </main>
  );
}

