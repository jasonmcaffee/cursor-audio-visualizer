'use client';

import { FaMicrophone, FaPlay, FaPause } from 'react-icons/fa';
import { useState, useEffect } from 'react';
import styles from './page.module.css';
import LoudnessMeter from './components/LoudnessMeter';
import CallbackCounters from './components/CallbackCounters';
import AudioLoudnessMeter from './services/AudioLoudnessMeter';
import WebAudioPlayer from './services/WebAudioPlayer';

export default function Home() {
  const [isRecording, setIsRecording] = useState(false);
  const [currentVolume, setCurrentVolume] = useState(0);
  const [volumeInfoCount, setVolumeInfoCount] = useState(0);
  const [audioAboveThresholdCount, setAudioAboveThresholdCount] = useState(0);
  const [silenceDetectedCount, setSilenceDetectedCount] = useState(0);
  const [audioMeter, setAudioMeter] = useState<AudioLoudnessMeter | null>(null);
  const [audioPlayer, setAudioPlayer] = useState<WebAudioPlayer | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const baselineVolume = 1.0; // Maximum volume

  useEffect(() => {
    const player = new WebAudioPlayer();
    setAudioPlayer(player);
    return () => {
      if (audioMeter) {
        audioMeter.stop();
      }
      if (player) {
        player.dispose();
      }
    };
  }, [audioMeter]);

  // Update volume when currentVolume changes and we're playing
  useEffect(() => {
    if (isPlaying && audioPlayer) {
      
     
    }
  }, [currentVolume, isPlaying]);

  const handlePlayClick = async () => {
    if (!audioPlayer) return;
    if (isPlaying) {
      audioPlayer.stop();
    } else {
      try {
        audioPlayer.setVolume(baselineVolume);
        await audioPlayer.playAudioFile('sounds/Alan Watts - Buddhism Religion of No Religion  1.mp3');
      } catch (error) {
        console.error('Error playing audio file:', error);
      }
    }
    setIsPlaying(!isPlaying);
  };

  const handleRecordClick = async () => {
    if (isRecording) {
      audioMeter?.stop();
      setIsRecording(false);
      return;
    }

    const meter = new AudioLoudnessMeter();
    const player = new WebAudioPlayer();
    setAudioMeter(meter);
    setAudioPlayer(player);

    try {
      await meter.start({
        onPeriodicVolumeInformation: (volume: number) => {
          setCurrentVolume(volume);
          setVolumeInfoCount(prev => prev + 1);
        },
        onAudioAboveThresholdDetected: async (audioBlob: Blob) => {
          setAudioAboveThresholdCount(prev => prev + 1);
          try {
            // await player.playAudioFile('sounds/confirmation-sound-12.mp3');
            // meter.resetSilenceDetection();
            console.log('audio above threshold detected');
            await player.playAudioBlob(audioBlob);
          } catch (error) {
            console.error('Error playing audio:', error);
          }
        },
        onSilenceDetected: async (audioBlob: Blob) => {
          console.log('silence detected');
          await player.playAudioBlob(audioBlob);
          setSilenceDetectedCount(prev => prev + 1);
          try {
            // await player.playAudioFile('sounds/confirmation-sound-14.mp3');
          } catch (error) {
            console.error('Error playing silence detection sound:', error);
          }
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

