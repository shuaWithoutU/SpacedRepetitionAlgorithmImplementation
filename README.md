# Spaced Repetition Algorithm Prototype
### Optimizing Clinical Readiness through Contextual Queueing and Application Scoring

This project is a specialized learning platform designed to bridge the gap between rote memorization and clinical application in medical education. Unlike traditional flashcard apps, this system utilizes **Contextual Queueing** to link related concepts and an **Application Confidence** scoring mechanism to prepare students for complex case studies.

## 🚀 Key Features
* **Contextual Queueing:** AI-assisted and manual linking of flashcards to build a cohesive mental schema rather than isolated facts.
* **Application Confidence Scoring:** A three-tier evaluation (High/Medium/Low) that forces users to assess their ability to apply knowledge in clinical scenarios.
* **Smart Dashboard:** Includes "Critical Weak Points" and "Study Workload" widgets to help students prioritize urgent tasks.
* **Optimized Algorithm:** An implementation based on the SM-2 algorithm, modified to handle contextual relationships between cards.

## 🛠️ Tech Stack
* **Frontend:** React.js, TypeScript, Tailwind CSS
* **Backend:** Python (Flask/FastAPI)
* **Database:** SQLite (local development)
* **AI Integration:** Semantic similarity analysis for card linking suggestions.


## 💻 Local Setup Instructions

### 1. Prerequisites
* Node.js (v16+)
* Python (v3.9+)
* Git

### 2. Clone the Repository
```bash 
git clone [https://github.com/shuaWithoutU/SpacedRepetitionAlgorithmImplementation.git](https://github.com/shuaWithoutU/SpacedRepetitionAlgorithmImplementation.git)
cd SpacedRepetitionAlgorithmImplementation

### 3. Backend Setup
cd backend
python -m venv venv
venv\Scripts\activate
source venv/bin/activate
pip install -r requirements.txt
python app.py

### 4. Frontend Setup
cd ../frontend
npm install
npm run dev
