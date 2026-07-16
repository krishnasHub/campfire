import { useState, useEffect, useCallback } from 'react'
import { getJSON, del } from './api.js'
import StartScreen from './screens/StartScreen.jsx'
import SetupScreen from './screens/SetupScreen.jsx'
import PlayScreen from './screens/PlayScreen.jsx'
import StoryEditor from './screens/StoryEditor.jsx'

const NAME_KEY = 'campfire-name'

export default function App() {
  const [companions, setCompanions] = useState([])
  const [campaigns, setCampaigns] = useState([])
  const [saves, setSaves] = useState([])
  const [userName, setUserName] = useState(() => localStorage.getItem(NAME_KEY) || '')
  const [view, setView] = useState('start')            // 'start' | 'setup' | 'play' | 'editor'
  const [setupCampaign, setSetupCampaign] = useState(null)
  const [sessionId, setSessionId] = useState(null)

  const refreshSaves = useCallback(() => { getJSON('/api/game/saves').then(setSaves).catch(() => {}) }, [])

  useEffect(() => {
    getJSON('/api/companions').then(setCompanions).catch(() => {})
    getJSON('/api/campaigns').then(setCampaigns).catch(() => {})
    refreshSaves()
  }, [refreshSaves])

  function saveName(n) { setUserName(n); localStorage.setItem(NAME_KEY, n) }
  function startSetup(c) { setSetupCampaign(c); setView('setup') }
  function resume(sid) { setSessionId(sid); setView('play') }
  async function deleteSave(sid) { await del('/api/game/' + sid); refreshSaves() }
  function beginPlay(sid) { setSessionId(sid); setView('play') }
  function exitToStart() { setSessionId(null); setSetupCampaign(null); setView('start'); refreshSaves() }
  function refreshCampaigns() { getJSON('/api/campaigns').then(setCampaigns).catch(() => {}) }

  if (view === 'editor') {
    return <StoryEditor onBack={() => setView('start')} onSaved={() => { refreshCampaigns() }} />
  }
  if (view === 'setup') {
    return <SetupScreen campaign={setupCampaign} companions={companions} userName={userName} onBegin={beginPlay} onBack={exitToStart} />
  }
  if (view === 'play') {
    return <PlayScreen sessionId={sessionId} companions={companions} onExit={exitToStart} />
  }
  return (
    <StartScreen
      companions={companions} campaigns={campaigns} saves={saves}
      userName={userName} onName={saveName}
      onPlay={startSetup} onResume={resume} onDelete={deleteSave}
      onCreate={() => setView('editor')}
    />
  )
}
