import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './App.css';

// --- TYPES ---
interface Card {
  id: number;
  front: string;
  back: string;
  is_application_card: boolean;
  interval: number;
  ease_factor: number;
  next_review: string;
  linked_ids: number[];
}

interface SearchResult {
  id: number;
  front: string;
  back: string;
  score?: number; // AI Score (Internal use only)
}

interface WeakCard {
  id: number;
  front: string;
  ease_factor: number;
  next_review: string;
}

function App() {
  // --- STATE ---
  const [view, setView] = useState<'dashboard' | 'study' | 'summary'>('dashboard');
  const [cards, setCards] = useState<Card[]>([]);
  const [weakCards, setWeakCards] = useState<WeakCard[]>([]); 
  
  // Creation State
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [isAppCard, setIsAppCard] = useState(false);
  const [message, setMessage] = useState('');
  
  // Linkage State
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [linkedCardIds, setLinkedCardIds] = useState<number[]>([]);
  
  // Edit State
  const [editingId, setEditingId] = useState<number | null>(null);
  
  // View Popup State
  const [viewingCard, setViewingCard] = useState<Card | null>(null);
  
  // AI State
  const [isLoadingAI, setIsLoadingAI] = useState(false);

  // Study Mode State
  const [studyQueue, setStudyQueue] = useState<Card[]>([]);
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [appConfidence, setAppConfidence] = useState<'High' | 'Medium' | 'Low' | null>(null);

  // Engagement State (Session Stats)
  const [sessionStats, setSessionStats] = useState({ again: 0, hard: 0, good: 0, easy: 0 });

  // Wellness State (Session Limiting)
  const [sessionLimit, setSessionLimit] = useState<number | 'all'>('all');

  useEffect(() => {
    refreshData(); // Initial load
  }, []);

  // --- CENTRALIZED DATA REFRESH ---
  const refreshData = async () => {
    await fetchCards();
    await fetchAnalytics();
  };

  const fetchCards = async () => {
    try {
      const response = await axios.get<Card[]>('http://127.0.0.1:5000/api/cards'); 
      const sortedCards = response.data.sort((a, b) => a.id - b.id);
      setCards(sortedCards);
    } catch (error) {
      console.error("Error fetching cards:", error);
    }
  };

  const fetchAnalytics = async () => {
    try {
      const response = await axios.get('http://127.0.0.1:5000/api/analytics/weakest');
      setWeakCards(response.data);
    } catch (error) {
      console.error("Error fetching analytics:", error);
    }
  };

  // --- ACTIONS ---
  const deleteCard = async (id: number) => {
    if (!confirm("Are you sure you want to delete this card?")) return;
    try {
      await axios.delete(`http://127.0.0.1:5000/api/cards/${id}`);
      refreshData();
    } catch (error) {
      console.error("Error deleting card:", error);
    }
  };

  // --- CREATION & AI FUNCTIONS ---
  const handleSearch = async (query: string) => {
    setSearchTerm(query);
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }
    try {
      const response = await axios.get(`http://127.0.0.1:5000/api/cards/search?q=${query}`);
      setSearchResults(response.data);
    } catch (error) {
      console.error(error);
    }
  };

  const handleEdit = (card: Card) => {
    setEditingId(card.id);
    setFront(card.front);
    setBack(card.back);
    setIsAppCard(card.is_application_card);
    setLinkedCardIds(card.linked_ids || []);
    setMessage(`Editing Card #${card.id}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setFront('');
    setBack('');
    setLinkedCardIds([]);
    setIsAppCard(false);
    setMessage('');
  };

  const handleAISuggest = async () => {
    if (!front && !back) {
      alert("Please enter a Question or Answer first so the AI has context.");
      return;
    }
    
    setIsLoadingAI(true);
    setSearchTerm("");
    try {
      const response = await axios.post('http://127.0.0.1:5000/api/ai/suggest', {
        front: front,
        back: back
      });
      setSearchResults(response.data); 
      setMessage(`AI found ${response.data.length} semantic matches.`);
    } catch (error) {
      console.error(error);
      setMessage("AI failed to generate suggestions.");
    } finally {
      setIsLoadingAI(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') e.preventDefault();
  };

  const toggleLink = (id: number) => {
    setLinkedCardIds(prev => {
      if (prev.includes(id)) {
        return prev.filter(linkId => linkId !== id); 
      } else {
        return [...prev, id]; 
      }
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingId) {
        await axios.put(`http://127.0.0.1:5000/api/cards/${editingId}`, {
          front,
          back,
          is_application_card: isAppCard,
          linked_ids: linkedCardIds 
        });
        setMessage('Success! Card updated.');
        setEditingId(null);
      } else {
        const cardRes = await axios.post('http://127.0.0.1:5000/api/cards', {
          front,
          back,
          is_application_card: isAppCard
        });
        const newId = cardRes.data.id;
        
        if (linkedCardIds.length > 0) {
          for (const tid of linkedCardIds) {
            await axios.post('http://127.0.0.1:5000/api/links', {
              source_id: newId,
              target_id: tid
            });
          }
        }
        setMessage(`Success! Added new card.`);
      }

      setFront('');
      setBack('');
      setSearchTerm('');
      setSearchResults([]);
      setLinkedCardIds([]);
      refreshData();
    } catch (err) {
      console.error(err);
      setMessage('Error saving card.');
    }
  };

  // --- STUDY MODE FUNCTIONS ---
  const startStudy = () => {
    const now = new Date();
    let due = cards.filter(c => new Date(c.next_review) <= now);
    
    if (due.length === 0) {
      alert("No cards due right now! Great job.");
      return;
    }

    due = due.sort(() => Math.random() - 0.5);

    const sortedQueue: Card[] = [];
    const visitedIds = new Set<number>();

    due.forEach(card => {
      if (!visitedIds.has(card.id)) {
        sortedQueue.push(card);
        visitedIds.add(card.id);

        if (card.linked_ids && card.linked_ids.length > 0) {
          card.linked_ids.forEach(linkedId => {
            const linkedCard = due.find(c => c.id === linkedId);
            if (linkedCard && !visitedIds.has(linkedCard.id)) {
              sortedQueue.push(linkedCard);
              visitedIds.add(linkedCard.id);
            }
          });
        }
      }
    });

    let finalQueue = sortedQueue;
    if (sessionLimit !== 'all') {
      finalQueue = sortedQueue.slice(0, sessionLimit);
    }

    setStudyQueue(finalQueue);
    setCurrentCardIndex(0);
    setIsFlipped(false);
    setAppConfidence(null);
    setSessionStats({ again: 0, hard: 0, good: 0, easy: 0 });
    setView('study');
  };

  const handleQuitSession = () => {
    refreshData();
    setView('dashboard');
  };

  const submitReview = async (grade: number) => {
    const currentCard = studyQueue[currentCardIndex];
    
    if (currentCard.is_application_card && !appConfidence) {
      alert("Please select your Application Confidence (High/Med/Low) first.");
      return;
    }

    try {
      await axios.post('http://127.0.0.1:5000/api/reviews', {
        card_id: currentCard.id,
        grade: grade,
        application_score: appConfidence,
        update_schedule: grade !== 1 
      });

      setSessionStats(prev => ({
        ...prev,
        again: grade === 1 ? prev.again + 1 : prev.again,
        hard: grade === 2 ? prev.hard + 1 : prev.hard,
        good: grade === 3 ? prev.good + 1 : prev.good,
        easy: grade === 4 ? prev.easy + 1 : prev.easy
      }));

      if (grade === 1) {
        const newQueue = [...studyQueue];
        const reInsertIndex = Math.min(currentCardIndex + 1, newQueue.length);
        newQueue.splice(reInsertIndex, 0, currentCard);
        setStudyQueue(newQueue);
      }

      if (currentCardIndex < studyQueue.length - 1) {
        setCurrentCardIndex(prev => prev + 1);
        setIsFlipped(false);
        setAppConfidence(null);
      } else {
        setView('summary');
        refreshData(); 
      }
    } catch (error) {
      console.error("Review failed", error);
    }
  };

  // --- VIEW: SESSION SUMMARY ---
  if (view === 'summary') {
    const total = sessionStats.again + sessionStats.hard + sessionStats.good + sessionStats.easy;
    const successRate = Math.round(((sessionStats.good + sessionStats.easy) / total) * 100) || 0;

    return (
      <div className="study-container">
        <div className="study-card">
          <h1>🎉 Session Complete!</h1>
          <p className="summary-subtitle">Great job staying engaged with your studies.</p>
          
          <div className="summary-circle">
            <span className="summary-score">{successRate}%</span>
            <span className="summary-label">Retention</span>
          </div>

          <div className="stats-grid">
            <div className="stat-box again">
              <span className="stat-num">{sessionStats.again}</span>
              <span className="stat-label">Again</span>
            </div>
            <div className="stat-box hard">
              <span className="stat-num">{sessionStats.hard}</span>
              <span className="stat-label">Hard</span>
            </div>
            <div className="stat-box good">
              <span className="stat-num">{sessionStats.good}</span>
              <span className="stat-label">Good</span>
            </div>
            <div className="stat-box easy">
              <span className="stat-num">{sessionStats.easy}</span>
              <span className="stat-label">Easy</span>
            </div>
          </div>

          <button className="study-start-btn" onClick={handleQuitSession} style={{marginTop: '30px'}}>
            Return to Dashboard
          </button>
        </div>
      </div>
    );
  }

  // --- VIEW: STUDY MODE ---
  if (view === 'study') {
    const card = studyQueue[currentCardIndex];
    if (!card) return <div>Loading...</div>;

    return (
      <div className="study-container">
        <div className="study-card">
          <div className="study-header">
            <span className="progress">
              Card {currentCardIndex + 1} / {studyQueue.length}
            </span>
            <button className="exit-btn" onClick={handleQuitSession}>
              Quit Session
            </button>
          </div>

          <div className="flashcard">
            <div className="card-content">
              <h3>{card.front}</h3>
              {isFlipped && (
                <div className="answer-section">
                  <hr />
                  <h3 className="answer-text">{card.back}</h3>
                  {card.is_application_card && (
                    <div className="app-score-section">
                      <h4 style={{fontSize: '0.9rem', marginBottom: '10px', color: '#166534'}}>Clinical Reasoning Confidence:</h4>
                      <div className="confidence-buttons">
                        {['Low', 'Medium', 'High'].map((level) => (
                          <button 
                            key={level}
                            className={`conf-btn ${appConfidence === level ? 'selected' : ''}`}
                            onClick={() => setAppConfidence(level as any)}
                          >
                            {level}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="controls">
            {!isFlipped ? (
              <button className="reveal-btn" onClick={() => setIsFlipped(true)}>
                Show Answer
              </button>
            ) : (
              <div className="grading-buttons">
                <button className="grade-btn again" onClick={() => submitReview(1)}>Again</button>
                <button className="grade-btn hard" onClick={() => submitReview(2)}>Hard</button>
                <button className="grade-btn good" onClick={() => submitReview(3)}>Good</button>
                <button className="grade-btn easy" onClick={() => submitReview(4)}>Easy</button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // --- WORKLOAD CALCULATION ---
  const dueCards = cards.filter(c => new Date(c.next_review) <= new Date());
  const highICLCount = dueCards.filter(c => c.is_application_card).length;
  const lowICLCount = dueCards.length - highICLCount;
  const totalSeconds = (lowICLCount * 15) + (highICLCount * 45);
  const estMinutes = Math.ceil(totalSeconds / 60);
  const loadColor = estMinutes > 20 ? '#ef4444' : estMinutes > 10 ? '#f59e0b' : '#10b981';
  const loadLevel = estMinutes > 20 ? 'Heavy' : estMinutes > 10 ? 'Moderate' : 'Light';

  // --- VIEW: DASHBOARD (GRID LAYOUT) ---
  return (
    <div className="container">
      <div className="header-row">
        <h1>MedX Dashboard</h1>
        <span className="date-badge">{new Date().toLocaleDateString()}</span>
      </div>

      <div className="dashboard-grid">
        <div className="grid-col-left">
          
          {/* A. WORKLOAD FORECAST */}
          {dueCards.length > 0 ? (
            <div className="section workload-card" style={{ borderTop: `4px solid ${loadColor}` }}>
              <div className="card-header">
                <h2>🧠 Study Workload</h2>
                <span className="load-badge" style={{ backgroundColor: loadColor }}>{loadLevel} Load</span>
              </div>
              
              <div className="metrics-row">
                <div className="metric">
                  <span className="metric-value">{dueCards.length}</span>
                  <span className="metric-label">Due Now</span>
                </div>
                <div className="metric">
                  <span className="metric-value" style={{ color: highICLCount > 0 ? '#dc2626' : '#666' }}>
                    {highICLCount}
                  </span>
                  <span className="metric-label">Application</span>
                </div>
                <div className="metric">
                  <span className="metric-value">{estMinutes}m</span>
                  <span className="metric-label">Est. Time</span>
                </div>
              </div>

              <div className="wellness-control">
                <label>⏱️ Session Limit:</label>
                <select 
                  value={sessionLimit} 
                  onChange={(e) => setSessionLimit(e.target.value === 'all' ? 'all' : parseInt(e.target.value))}
                >
                  <option value="all">Study All ({estMinutes} min)</option>
                  <option value={5}>Micro (5 Cards)</option>
                  {dueCards.length > 10 && <option value={10}>Quick (10 Cards)</option>}
                  {dueCards.length > 20 && <option value={20}>Standard (20 Cards)</option>}
                </select>
              </div>

              <button className="study-start-btn" onClick={startStudy}>
                Study Now
              </button>
            </div>
          ) : (
            <div className="section empty-state">
              <h2>🎉 All caught up!</h2>
              <p>No cards due. Great job managing your cognitive load.</p>
            </div>
          )}

          {/* B. PROBLEM AREAS (ANALYTICS) */}
          <div className="section problem-area-card">
            <h2>📉 Critical Weak Points</h2>
            <p className="subtitle">Lowest Ease Factors (Needs Review)</p>

            {weakCards.length > 0 ? (
              <div className="weak-list">
                {weakCards.map(c => (
                  <div key={c.id} className="weak-item">
                    <span className="weak-front">{c.front}</span>
                    <span className="weak-score">EF: {c.ease_factor}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="good-job-box">
                ✅ No critical weak spots detected.
              </div>
            )}
          </div>
        </div>

        {/* COLUMN 2: CREATE NEW CARD (COMPACT) */}
        <div className="grid-col-right">
          <div className="section card-form">
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
              <h2>{editingId ? `✏️ Editing Card #${editingId}` : '➕ Quick Add'}</h2>
              {editingId && (
                <button type="button" onClick={cancelEdit} style={{background: '#64748b', fontSize: '0.8rem', padding: '5px 10px'}}>
                  Cancel Edit
                </button>
              )}
            </div>

            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Front (Question)</label>
                <input type="text" value={front} onChange={(e) => setFront(e.target.value)} required />
              </div>
              <div className="form-group">
                <label>Back (Answer)</label>
                <textarea value={back} onChange={(e) => setBack(e.target.value)} required />
              </div>

              <div className="schema-section-compact">
                  <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px'}}>
                  <label style={{margin:0, fontWeight: 'bold', color: '#cbd5e1'}}>🔗 Link to Schema</label>
                  <button 
                    type="button" 
                    onClick={handleAISuggest}
                    disabled={isLoadingAI}
                    className="ai-btn"
                    title="Auto-find related cards based on meaning"
                  >
                    {isLoadingAI ? 'Thinking...' : '✨ AI Suggest'}
                  </button>
                </div>
                
                <input type="text" placeholder="Or search manually..." value={searchTerm} 
                      onChange={(e) => handleSearch(e.target.value)} onKeyDown={handleKeyDown} className="search-box-compact"/>
                
                {searchResults.length > 0 && (
                  <div className="search-results-compact">
                    {searchResults.map(r => (
                      <div key={r.id} className="search-item-compact">
                        <span>{r.front}</span>
                        <button type="button" onClick={() => toggleLink(r.id)} 
                                className={linkedCardIds.includes(r.id) ? 'btn-linked-sm' : 'btn-link-sm'}>
                          {linkedCardIds.includes(r.id) ? '✓' : '+'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {linkedCardIds.length > 0 && <span className="link-count-badge">{linkedCardIds.length} Linked</span>}
              </div>

              <div className="form-group checkbox-row">
                <input type="checkbox" id="isApp" checked={isAppCard} onChange={(e) => setIsAppCard(e.target.checked)} /> 
                <label htmlFor="isApp">Is Application Card?</label>
              </div>
              <button type="submit" className="submit-btn-compact" style={{backgroundColor: editingId ? '#f59e0b' : '#10b981'}}>
                {editingId ? 'Update Card' : 'Save Card'}
              </button>
            </form>
            {message && <p className="status-msg-compact">{message}</p>}
          </div>
        </div>
      </div>

      {/* FULL WIDTH: CARD LIST */}
      <div className="section card-list-section">
        <h2>📚 Flashcard List ({cards.length})</h2>
        <div className="table-responsive">
          <table>
            <thead>
              <tr>
                <th style={{ width: '40%' }}>Question</th>
                <th style={{ width: '10%' }}>Type</th>
                <th style={{ width: '20%' }}>Links</th>
                <th style={{ width: '15%' }}>Next Due</th>
                <th style={{ width: '15%' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {cards.map(c => (
                <tr key={c.id}>
                  <td className="text-cell">{c.front}</td>
                  <td>
                    {c.is_application_card ? (
                      <span className="pill pill-app">Application</span>
                    ) : (
                      <span className="pill pill-recall">Recall</span>
                    )}
                  </td>
                  <td>{c.linked_ids && c.linked_ids.length > 0 ? <span className="link-text">🔗 {c.linked_ids.join(", ")}</span> : <span className="empty-dash">-</span>}</td>
                  <td className="date-cell">{new Date(c.next_review).toLocaleDateString()} <small>{new Date(c.next_review).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</small></td>
                  <td>
                    <button onClick={() => setViewingCard(c)} className="icon-btn-view" title="Quick View">👁️</button>
                    <button onClick={() => handleEdit(c)} className="icon-btn-edit" title="Edit Details">✏️</button>
                    <button onClick={() => deleteCard(c.id)} className="icon-btn-delete" title="Delete">🗑️</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* VIEW POPUP */}
      {viewingCard && (
        <div className="modal-overlay" onClick={() => setViewingCard(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Card #{viewingCard.id} Details</h3>
              <button className="modal-close-btn" onClick={() => setViewingCard(null)}>×</button>
            </div>
            
            <div className="modal-body">
              <div className="modal-field">
                <span className="modal-label">Q: Question</span>
                <div className="modal-text">{viewingCard.front}</div>
              </div>
              
              <div className="modal-field">
                <span className="modal-label">A: Answer</span>
                <div className="modal-text answer-text">{viewingCard.back}</div>
              </div>

              <div className="modal-meta">
                <span className="pill pill-recall" style={{marginRight: '10px'}}>
                  Ease Factor: {viewingCard.ease_factor}
                </span>
                <span className="pill pill-recall">
                  Interval: {viewingCard.interval} days
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;