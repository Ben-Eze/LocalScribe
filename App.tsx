import { useState } from 'react';
import { StatusBar } from 'expo-status-bar';

import ChatScreen from './src/ChatScreen';
import DownloadScreen from './src/DownloadScreen';
import { isModelDownloaded } from './src/model';

export default function App() {
  const [hasModel, setHasModel] = useState(isModelDownloaded);

  return (
    <>
      {hasModel ? (
        <ChatScreen onModelDeleted={() => setHasModel(false)} />
      ) : (
        <DownloadScreen onDone={() => setHasModel(true)} />
      )}
      <StatusBar style="auto" />
    </>
  );
}
