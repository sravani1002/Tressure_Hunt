import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { io } from 'socket.io-client';
import './styles.css';

const socket = io(import.meta.env.VITE_SERVER_URL || undefined, { autoConnect: false });
const tileInfo = {
  gold: ['●', 'Gold'], diamond: ['◆', 'Diamond'], crown: ['♛', 'Crown'], chest: ['▣', 'Risk chest'],
  trap: ['!', 'Trap'], mystery: ['?', 'Mystery'], shield: ['⬡', 'Shield'], teleport: ['↗', 'Teleport'],
  double: ['×2', 'Double points'], challenge: ['⚡', 'Quick Draw'], empty: ['', ''], hidden: ['', 'Hidden tile'],
};
const tileLegend = [
  ['gold', '+10', 'Gold'], ['diamond', '+25', 'Diamond'], ['crown', '+40', 'Crown'], ['chest', '15 / 50', 'Risk chest'],
  ['trap', '−20', 'Trap'], ['mystery', '?', 'Mystery'], ['shield', 'BLOCK', 'Shield'], ['double', '×2', 'Double points'],
  ['teleport', '↗', 'Teleport'], ['challenge', 'DUEL', 'Quick Draw'],
];

function useRoomConnection() {
  const [connected, setConnected] = useState(socket.connected);
  const [room, setRoom] = useState(null);
  const [playerId, setPlayerId] = useState('');
  const [networkError, setNetworkError] = useState('');

  useEffect(() => {
    const handleConnect = () => {
      setConnected(true);
      setNetworkError('');
      try {
        const saved = JSON.parse(localStorage.getItem('treasure-rush-session') || 'null');
        if (saved?.code && saved?.resumeToken) {
          socket.emit('room:reconnect', saved, (response) => {
            if (response?.ok) {
              setRoom(response.room);
              setPlayerId(response.playerId);
            } else {
              localStorage.removeItem('treasure-rush-session');
            }
          });
        }
      } catch {
        localStorage.removeItem('treasure-rush-session');
      }
    };
    const handleDisconnect = () => setConnected(false);
    const handleConnectError = () => setNetworkError('The game server is unavailable. Check that it is running, then reconnect.');
    const handleRoom = (nextRoom) => setRoom(nextRoom);
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('connect_error', handleConnectError);
    socket.on('room:update', handleRoom);
    socket.connect();
    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('connect_error', handleConnectError);
      socket.off('room:update', handleRoom);
      socket.disconnect();
    };
  }, []);

  const act = (event, payload) => new Promise((resolve) => {
    if (!socket.connected) return resolve({ ok: false, error: 'Disconnected from the game server.' });
    socket.timeout(8000).emit(event, payload, (timeout, response) => {
      if (timeout) resolve({ ok: false, error: 'The server did not respond. Please try again.' });
      else resolve(response || { ok: false, error: 'Unexpected server response.' });
    });
  });

  const enterRoom = (response) => {
    setRoom(response.room);
    setPlayerId(response.playerId);
    localStorage.setItem('treasure-rush-session', JSON.stringify({ code: response.code, resumeToken: response.resumeToken }));
    setNetworkError('');
  };

  const leaveRoom = async () => {
    if (room) await act('room:leave', { code: room.code });
    localStorage.removeItem('treasure-rush-session');
    setRoom(null);
    setPlayerId('');
  };

  return { connected, room, playerId, networkError, setNetworkError, act, enterRoom, leaveRoom };
}

function App() {
  const { connected, room, playerId, networkError, setNetworkError, act, enterRoom, leaveRoom } = useRoomConnection();
  const [name, setName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [joinMode, setJoinMode] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [toast, setToast] = useState('');
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const [copied, setCopied] = useState(false);
  const me = room?.players.find((player) => player.id === playerId);
  const currentPlayer = room?.players.find((player) => player.id === room.currentPlayerId);
  const isMyTurn = room?.currentPlayerId === playerId;
  const timer = room?.turnEndsAt ? Math.max(0, Math.ceil((room.turnEndsAt - clock) / 1000)) : 0;

  useEffect(() => {
    const interval = window.setInterval(() => setClock(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!room?.event?.title) return undefined;
    setToast(`${room.event.title}${room.event.detail ? ` ${room.event.detail}` : ''}`);
    const timeout = window.setTimeout(() => setToast(''), 4000);
    return () => window.clearTimeout(timeout);
  }, [room?.revision]);

  const submit = async (event) => {
    event.preventDefault();
    setNetworkError('');
    const response = joinMode
      ? await act('room:join', { code: roomCode, name })
      : await act('room:create', { name });
    if (!response?.ok) setNetworkError(response?.error || 'Could not enter the room.');
    else enterRoom(response);
  };

  const runAction = async (event, payload) => {
    const response = await act(event, { code: room.code, ...payload });
    if (!response?.ok) setNetworkError(response?.error || 'That action could not be completed.');
    else setNetworkError('');
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(room.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setNetworkError(`Share code ${room.code} with your friends.`);
    }
  };

  const playSound = (kind) => {
    if (!soundEnabled) return;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      const audio = new AudioContextClass();
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      const frequencies = { treasure: 660, trap: 170, mystery: 480, challenge: 760, winner: 880 };
      oscillator.frequency.value = frequencies[kind] || 380;
      oscillator.type = kind === 'trap' ? 'triangle' : 'sine';
      gain.gain.setValueAtTime(0.08, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.16);
      oscillator.connect(gain);
      gain.connect(audio.destination);
      oscillator.start();
      oscillator.stop(audio.currentTime + 0.16);
      oscillator.onended = () => audio.close();
    } catch {
      setSoundEnabled(false);
    }
  };

  useEffect(() => {
    if (room?.event?.kind) playSound(room.event.kind);
  }, [room?.revision]);

  if (!room) {
    return (
      <main className="home-shell">
        <header className="topbar">
          <a className="wordmark" href="#home" aria-label="Treasure Rush home"><span className="brand-mark">T</span><span>TREASURE <b>RUSH</b></span></a>
          <div className="topbar-right"><span className={`connection ${connected ? 'online' : ''}`}><i />{connected ? 'SERVER READY' : 'CONNECTING'}</span><button className="text-button" onClick={() => setShowRules(true)}>How to play <span>↗</span></button></div>
        </header>
        <section className="hero-grid" id="home">
          <div className="hero-copy">
            <p className="eyebrow"><span /> 2–8 PLAYERS · 15-SECOND TURNS</p>
            <h1>Outwit the map.<br /><em>Claim the crown.</em></h1>
            <p className="hero-description">A quick-witted treasure hunt for your crew. Read the map, risk the chest, and make every turn count.</p>
            <div className="hero-actions">
              <button className="button button-primary" onClick={() => { setJoinMode(false); document.getElementById('player-name')?.focus(); }}>Create a room <span>↗</span></button>
              <button className="button button-secondary" onClick={() => { setJoinMode(true); document.getElementById('room-code')?.focus(); }}>Join with a code</button>
            </div>
            <form className="entry-form" onSubmit={submit}>
              <label htmlFor="player-name">YOUR NAME</label>
              <input id="player-name" autoComplete="nickname" maxLength={18} placeholder="What should we call you?" value={name} onChange={(event) => setName(event.target.value)} required />
              {joinMode && <><label htmlFor="room-code">ROOM CODE</label><input id="room-code" className="code-input" placeholder="TR7K2" maxLength={5} value={roomCode} onChange={(event) => setRoomCode(event.target.value.toUpperCase())} required /></>}
              <button className="button button-dark" type="submit" disabled={!connected}>{joinMode ? 'Join the hunt' : 'Create room'} <span>→</span></button>
              {networkError && <p className="form-error" role="alert">{networkError}</p>}
            </form>
            <div className="quick-facts"><span><b>01</b> Create or join</span><span><b>02</b> Take your turn</span><span><b>03</b> Win the treasure</span></div>
          </div>
          <div className="map-art" aria-label="Illustrated treasure map with a marked destination">
            <div className="map-topline"><span>FIELD NOTES / 07</span><span>THE LOST ARCHIPELAGO</span></div>
            <div className="map-land land-one" /><div className="map-land land-two" /><div className="map-land land-three" />
            <svg className="map-route" viewBox="0 0 520 500" aria-hidden="true"><path d="M83 390 C128 348 118 270 201 284 S260 358 306 282 S361 192 445 130" /><circle cx="83" cy="390" r="7" /><circle cx="201" cy="284" r="6" /><circle cx="306" cy="282" r="6" /><circle cx="445" cy="130" r="8" /></svg>
            <div className="map-compass"><span>N</span><b>✳</b><small>S</small></div>
            <div className="map-stamp"><span>THE</span><strong>LAST<br />TREASURE</strong><i>✦</i></div>
            <div className="map-note note-one">OLD SALT ROAD</div><div className="map-note note-two">DANGER<br />BELOW</div>
            <div className="map-coordinates">19° 24' N<br />71° 08' W</div>
            <div className="map-footer"><span>EST. 1724</span><span>✦ ✦ ✦</span><span>NO. 01</span></div>
          </div>
        </section>
        <section className="home-bottom">
          <div><span className="section-number">A / THE OBJECTIVE</span><p>Be the first to find <b>100 points</b>. Everyone gets one last turn before the winner is crowned.</p></div>
          <button className="rules-link" onClick={() => setShowRules(true)}>Read the field guide <span>↗</span></button>
        </section>
        {!connected && <div className="network-banner" role="status">Waiting for the server. Start the project with <code>npm run dev</code>.</div>}
        {showRules && <RulesDialog onClose={() => setShowRules(false)} />}
      </main>
    );
  }

  if (room.phase === 'LOBBY') {
    return <Lobby room={room} me={me} networkError={networkError} copied={copied} onCopy={copyCode} onStart={() => runAction('room:start')} onLeave={leaveRoom} />;
  }

  if (room.phase === 'GAME_OVER') {
    const winners = room.players.filter((player) => room.winnerIds.includes(player.id));
    return (
      <main className="game-shell game-over-shell">
        <GameHeader room={room} me={me} onLeave={leaveRoom} soundEnabled={soundEnabled} setSoundEnabled={setSoundEnabled} />
        <section className="winner-stage">
          <div className="winner-spark">✦</div><p className="eyebrow">THE HUNT IS OVER</p>
          <h1>{winners.length > 1 ? 'A shared victory.' : `${winners[0]?.name} takes it.`}</h1>
          <p className="winner-score">{winners.map((winner) => winner.score).join(' · ')} <span>POINTS</span></p>
          <div className="final-table"><Leaderboard room={room} playerId={playerId} final /></div>
          <div className="winner-actions"><button className="button button-primary" onClick={() => runAction('room:replay')}>Play again <span>↻</span></button><button className="button button-secondary" onClick={leaveRoom}>Return home</button></div>
          {networkError && <p className="form-error" role="alert">{networkError}</p>}
        </section>
      </main>
    );
  }

  return (
    <main className="game-shell">
      <GameHeader room={room} me={me} onLeave={leaveRoom} soundEnabled={soundEnabled} setSoundEnabled={setSoundEnabled} />
      <div className="game-layout">
        <section className="board-column">
          <div className="turn-banner">
            <div className="turn-avatar" style={{ '--player-color': currentPlayer?.color }}>{currentPlayer?.name?.slice(0, 1) || '·'}</div>
            <div className="turn-copy"><span>{room.phase === 'FINAL_ROUND' ? 'FINAL ROUND' : room.phase === 'CHALLENGE' ? 'QUICK DRAW' : room.phase === 'CHEST_DECISION' ? 'YOUR REWARD' : 'CURRENT TURN'}</span><strong>{room.phase === 'CHALLENGE' ? 'The duel is on' : room.phase === 'CHEST_DECISION' ? 'Choose your risk' : currentPlayer?.name || 'Waiting'}</strong></div>
            <div className={`timer ${timer <= 5 ? 'timer-urgent' : ''}`} aria-label={`${timer} seconds remaining`}><strong>{timer.toString().padStart(2, '0')}</strong><span>SEC</span></div>
          </div>
          <div className="board-frame">
            <div className="board-heading"><div><span className="section-number">THE ISLANDS / {room.code}</span><h2>Treasure map</h2></div><span className="map-scale">N ↑</span></div>
            <div className="game-board" role="grid" aria-label="Shared 10 by 10 treasure map">
              {room.board.map((tile) => {
                const occupants = room.players.filter((player) => player.position.x + player.position.y * 10 === tile.id);
                const [symbol, label] = tileInfo[tile.type] || ['', ''];
                return <div className={`board-tile ${tile.type !== 'empty' && tile.type !== 'hidden' ? `tile-${tile.type}` : ''} ${tile.revealed ? 'tile-revealed' : ''} ${occupants.length ? 'tile-occupied' : ''}`} key={tile.id} role="gridcell" aria-label={`Tile ${tile.id + 1}: ${label || 'open ground'}${occupants.length ? `, ${occupants.map((player) => player.name).join(', ')}` : ''}`}>
                  {tile.type !== 'hidden' && symbol && <span className="tile-symbol" aria-hidden="true">{symbol}</span>}
                  {occupants.length > 0 && <div className="tile-players">{occupants.map((player) => <span className={`player-token ${player.id === room.currentPlayerId ? 'token-active' : ''}`} key={player.id} style={{ '--player-color': player.color }} title={player.name}>{player.name.slice(0, 1)}</span>)}</div>}
                </div>;
              })}
            </div>
            <div className="board-legend"><span><i className="legend-hidden" /> Unexplored</span><span><i className="legend-found" /> Revealed</span><span><i className="legend-player" /> Player</span></div>
          </div>
          <div className="movement-panel">
            <div className="movement-copy"><span className="section-number">YOUR MOVE</span><strong>{isMyTurn ? 'Pick a direction' : `Waiting for ${currentPlayer?.name || 'player'}`}</strong><small>{isMyTurn ? 'One tile. Make it count.' : 'The map updates for everyone.'}</small></div>
            <div className="d-pad" aria-label="Move one tile">
              <span /><button aria-label="Move up" disabled={!isMyTurn || !['PLAYING', 'FINAL_ROUND'].includes(room.phase)} onClick={() => runAction('game:move', { direction: 'up' })}>↑</button><span />
              <button aria-label="Move left" disabled={!isMyTurn || !['PLAYING', 'FINAL_ROUND'].includes(room.phase)} onClick={() => runAction('game:move', { direction: 'left' })}>←</button>
              <button aria-label="Move down" disabled={!isMyTurn || !['PLAYING', 'FINAL_ROUND'].includes(room.phase)} onClick={() => runAction('game:move', { direction: 'down' })}>↓</button>
              <button aria-label="Move right" disabled={!isMyTurn || !['PLAYING', 'FINAL_ROUND'].includes(room.phase)} onClick={() => runAction('game:move', { direction: 'right' })}>→</button>
            </div>
          </div>
          {room.phase === 'CHEST_DECISION' && room.pendingChest?.playerId === playerId && <section className="decision-panel"><div><span className="section-number">A RISK WORTH TAKING?</span><h3>Choose your reward</h3><p>Safe: +15 guaranteed. Risky: 70% chance of +50, 30% chance of −30.</p></div><button className="button button-secondary" onClick={() => runAction('game:chest', { choice: 'safe' })}>Play it safe <b>+15</b></button><button className="button button-primary" onClick={() => runAction('game:chest', { choice: 'risky' })}>Take the risk <b>70 / 30</b></button></section>}
          {networkError && <p className="inline-error" role="alert">{networkError}</p>}
        </section>
        <aside className="game-sidebar">
          <div className="sidebar-panel score-panel"><div className="panel-heading"><div><span className="section-number">LIVE STANDINGS</span><h2>Leaderboard</h2></div><span className="live-dot">LIVE</span></div><Leaderboard room={room} playerId={playerId} /></div>
          <div className="sidebar-panel status-panel"><div className="panel-heading"><div><span className="section-number">YOUR KIT</span><h2>Field status</h2></div></div><div className="kit-row"><span className={`kit-icon ${me?.shield ? 'kit-active' : ''}`}>⬡</span><span><b>Shield</b><small>Blocks one trap</small></span><strong>{me?.shield ? 'READY' : '—'}</strong></div><div className="kit-row"><span className={`kit-icon ${me?.doublePoints ? 'kit-active' : ''}`}>×2</span><span><b>Double points</b><small>Next treasure</small></span><strong>{me?.doublePoints ? 'READY' : '—'}</strong></div><div className="my-score"><span>YOUR SCORE</span><b>{me?.score ?? 0}<i> pts</i></b></div></div>
          <div className="sidebar-panel legend-panel"><div className="panel-heading"><div><span className="section-number">FIELD GUIDE</span><h2>Map symbols</h2></div><button className="mini-help" aria-label="Open rules" onClick={() => setShowRules(true)}>?</button></div><div className="legend-list">{tileLegend.map(([type, value, title]) => <div className="legend-row" key={type}><span className={`legend-symbol legend-${type}`}>{tileInfo[type][0]}</span><b>{title}</b><span>{value}</span></div>)}</div></div>
          <div className="sidebar-foot"><span>{room.players.filter((player) => player.connected).length} explorers connected</span><span>Code {room.code}</span></div>
        </aside>
      </div>
      {room.phase === 'CHALLENGE' && room.challenge && <ChallengeDialog room={room} playerId={playerId} onPress={() => runAction('game:quick-draw')} />}
      {showRules && <RulesDialog onClose={() => setShowRules(false)} />}
      {toast && <div className={`toast toast-${room.event?.kind || 'default'}`} role="status" key={room.revision}><span>✦</span><p>{toast}</p></div>}
    </main>
  );
}

function GameHeader({ room, me, onLeave, soundEnabled, setSoundEnabled }) {
  return <header className="game-topbar"><a className="wordmark" href="#home" onClick={(event) => { event.preventDefault(); onLeave(); }}><span className="brand-mark">T</span><span>TREASURE <b>RUSH</b></span></a><div className="game-top-meta"><span className="room-pill">ROOM <b>{room.code}</b></span><span className="top-player"><i style={{ '--player-color': me?.color }} />{me?.name || 'Explorer'}</span><button className="icon-button sound-toggle" aria-label={soundEnabled ? 'Mute game sounds' : 'Enable game sounds'} title={soundEnabled ? 'Mute sound' : 'Enable sound'} onClick={() => setSoundEnabled(!soundEnabled)}>{soundEnabled ? '♫' : '♪̸'}</button><button className="leave-button" onClick={onLeave}>Leave <span>↗</span></button></div></header>;
}

function Lobby({ room, me, networkError, copied, onCopy, onStart, onLeave }) {
  const isHost = me?.id === room.hostId;
  return <main className="lobby-shell"><GameHeader room={room} me={me} onLeave={onLeave} soundEnabled={false} setSoundEnabled={() => {}} />
    <section className="lobby-content"><div className="lobby-intro"><span className="section-number">BEFORE THE HUNT / 01</span><h1>Gather your crew.</h1><p>When everyone is here, the host can open the map.</p></div>
      <div className="room-share"><div><span>YOUR ROOM CODE</span><strong>{room.code}</strong></div><button onClick={onCopy} aria-label="Copy room code">{copied ? 'Copied ✓' : 'Copy code ↗'}</button></div>
      <div className="lobby-player-heading"><div><span className="section-number">EXPLORERS</span><h2>{room.players.length}<small> / 8 players</small></h2></div><span className="status-live"><i /> ROOM OPEN</span></div>
      <div className="player-list">{room.players.map((player, index) => <div className={`lobby-player ${player.id === me?.id ? 'is-me' : ''}`} key={player.id}><span className="player-avatar" style={{ '--player-color': player.color }}>{player.name.slice(0, 1)}</span><span className="lobby-player-name"><b>{player.name}{player.id === me?.id ? ' (you)' : ''}</b><small>{player.isHost ? 'Room host' : `Explorer ${String(index + 1).padStart(2, '0')}`}</small></span><span className={`player-status ${player.connected ? 'status-connected' : ''}`}><i />{player.connected ? 'READY' : 'RECONNECTING'}</span></div>)}</div>
      <div className="lobby-bottom">{isHost ? <><button className="button button-primary start-button" onClick={onStart} disabled={room.players.filter((player) => player.connected).length < 2}>Start game <span>→</span></button><p>{room.players.filter((player) => player.connected).length < 2 ? 'Waiting for at least 2 players...' : 'Your crew is ready. Start when you are.'}</p></> : <p className="waiting-message"><span className="waiting-pulse" />Waiting for the host to start the hunt…</p>}{networkError && <p className="form-error" role="alert">{networkError}</p>}</div>
    </section>
  </main>;
}

function Leaderboard({ room, playerId, final = false }) {
  return <ol className={`leaderboard ${final ? 'leaderboard-final' : ''}`}>{room.leaderboard.map((player, index) => <li className={player.id === playerId ? 'rank-me' : ''} key={player.id}><span className="rank-number">{String(index + 1).padStart(2, '0')}</span><span className="rank-avatar" style={{ '--player-color': player.color }}>{player.name.slice(0, 1)}</span><span className="rank-name"><b>{player.name}</b><small>{player.treasures} {player.treasures === 1 ? 'treasure' : 'treasures'}{player.connected ? '' : ' · away'}</small></span><strong className="rank-score">{player.score}<small>PTS</small></strong></li>)}</ol>;
}

function ChallengeDialog({ room, playerId, onPress }) {
  const challenge = room.challenge;
  const players = [challenge.challengerId, challenge.opponentId].map((id) => room.players.find((player) => player.id === id));
  const participant = players.some((player) => player?.id === playerId);
  return <div className={`modal-backdrop challenge-backdrop ${challenge.stage === 'go' ? 'challenge-go' : ''}`} role="dialog" aria-modal="true" aria-labelledby="challenge-title"><section className="challenge-modal"><span className="section-number">A QUICK DRAW / {challenge.stage === 'go' ? 'GO!' : 'GET READY'}</span><div className="challenge-bolt">⚡</div><h2 id="challenge-title">{challenge.stage === 'go' ? 'DRAW!' : 'Eyes on the map.'}</h2><p>{challenge.stage === 'go' ? 'First explorer to tap wins 20 points.' : 'Wait for GO. Tap too early and you lose your shot.'}</p><div className="duel-players">{players.map((player) => <span key={player?.id} className={player?.id === playerId ? 'duel-me' : ''}><i style={{ '--player-color': player?.color }} />{player?.name || 'Explorer'}</span>)}</div><button className="button button-primary draw-button" onClick={onPress} disabled={!participant || challenge.stage !== 'go'}>{challenge.stage === 'go' ? 'I’m ready!' : 'Wait for GO...'}</button>{!participant && <small>You are spectating this duel.</small>}</section></div>;
}

function RulesDialog({ onClose }) {
  useEffect(() => {
    const closeOnEscape = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);
  return <div className="modal-backdrop rules-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="rules-modal" role="dialog" aria-modal="true" aria-labelledby="rules-title"><div className="rules-head"><div><span className="section-number">FIELD GUIDE / 00</span><h2 id="rules-title">How to play</h2></div><button className="close-button" onClick={onClose} aria-label="Close rules">×</button></div><p className="rules-lead">Read the map. Trust your crew. Know when to risk it.</p><ol className="rules-steps"><li><b>Make a room</b><span>Create one, or join a friend's five-character code. Bring 2–8 players.</span></li><li><b>Take your turn</b><span>Move one tile in any direction. You have 15 seconds before your turn is skipped.</span></li><li><b>Find the good stuff</b><span>Gold is +10, diamonds +25, crowns +40. Chests offer a safe +15 or a risky bet.</span></li><li><b>Watch your step</b><span>Traps take 20 points. A shield blocks one. Mystery tiles and Quick Draw duels can change the lead.</span></li><li><b>Finish the round</b><span>Reaching 100 starts the final round. Everyone gets an equal number of turns; highest score wins.</span></li></ol><div className="rules-tile-list">{tileLegend.map(([type, value, title]) => <span key={type}><i className={`legend-${type}`}>{tileInfo[type][0]}</i><b>{title}</b><small>{value}</small></span>)}</div><button className="button button-dark rules-done" onClick={onClose}>Got it <span>→</span></button></section></div>;
}

const container = document.getElementById('root');
const root = globalThis.__treasureRushRoot || ReactDOM.createRoot(container);
globalThis.__treasureRushRoot = root;
root.render(<React.StrictMode><App /></React.StrictMode>);
