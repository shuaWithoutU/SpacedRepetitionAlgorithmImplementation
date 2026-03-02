from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime, timedelta
from sqlalchemy import or_
# --- AI IMPORTS ---
from sentence_transformers import SentenceTransformer, util

app = Flask(__name__)
CORS(app)  # Allow frontend to communicate with this backend

# DATABASE
# Ensure your password is correct here
app.config['SQLALCHEMY_DATABASE_URI'] = 'postgresql://postgres:joshua@localhost/medspacedrep_db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)

# LOAD AI MODEL
# 'all-MiniLM-L6-v2' is optimized for speed/performance balance
ai_model = SentenceTransformer('all-MiniLM-L6-v2')


# TABLES

class Flashcard(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    front = db.Column(db.String(500), nullable=False)  # The Question
    back = db.Column(db.String(500), nullable=False)  # The Answer
    is_application_card = db.Column(db.Boolean, default=False)  # Flag for research
    
    # Spaced Repetition Metrics
    interval = db.Column(db.Float, default=1.0)  # Days until next review
    ease_factor = db.Column(db.Float, default=2.5)  # Difficulty multiplier
    
    # FIX: Use UTC now. The Frontend (Browser) will convert this to Local Device Time.
    next_review = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Research Metrics
    application_score_history = db.Column(db.String(1000), default="")  # Logs: "High,Low,Medium"


class SchemaLink(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    # This table links two cards together
    source_card_id = db.Column(db.Integer, db.ForeignKey('flashcard.id'), nullable=False)
    target_card_id = db.Column(db.Integer, db.ForeignKey('flashcard.id'), nullable=False)
    relationship_type = db.Column(db.String(100), default="Clinical Connection")


# ROUTES

# Route to Add a New Card
@app.route('/api/cards', methods=['POST'])
def add_card():
    data = request.json
    
    # FIX: Use UTC Now.
    # We subtract 1 minute just to be 100% sure it's in the past compared to the browser execution time.
    initial_review_date = datetime.utcnow() - timedelta(minutes=1)

    # Create a new Flashcard object
    new_card = Flashcard(
        front=data['front'],
        back=data['back'],
        is_application_card=data.get('is_application_card', False),
        next_review=initial_review_date
    )
    
    # Add to database and save
    try:
        db.session.add(new_card)
        db.session.commit()
        return jsonify({"message": "Card added successfully!", "id": new_card.id}), 201
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# Route to Get All Cards (Updated with Links)
@app.route('/api/cards', methods=['GET'])
def get_cards():
    try:
        cards = Flashcard.query.all()
        output = []
        for card in cards:
            # 1. Find all links where this card is the SOURCE
            links_as_source = SchemaLink.query.filter_by(source_card_id=card.id).all()
            linked_ids = [link.target_card_id for link in links_as_source]
            
            # 2. Find all links where this card is the TARGET (Bi-directional visibility)
            links_as_target = SchemaLink.query.filter_by(target_card_id=card.id).all()
            linked_ids.extend([link.source_card_id for link in links_as_target])

            # Remove duplicates just in case
            linked_ids = list(set(linked_ids))

            card_data = {
                'id': card.id,
                'front': card.front,
                'back': card.back,
                'is_application_card': card.is_application_card,
                'next_review': card.next_review,
                'interval': card.interval,
                'ease_factor': card.ease_factor,
                'linked_ids': linked_ids
            }
            output.append(card_data)
        return jsonify(output), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# Route to Search Cards (For Recommendation)
@app.route('/api/cards/search', methods=['GET'])
def search_cards():
    query = request.args.get('q', '')  # Get the search term from URL
    if not query:
        return jsonify([])

    # Logic: Find cards where 'front' OR 'back' contains the search term
    # This is the "Recommendation Factor" (Text Matching)
    results = Flashcard.query.filter(
        or_(Flashcard.front.ilike(f'%{query}%'), Flashcard.back.ilike(f'%{query}%'))
    ).limit(10).all()

    output = []
    for card in results:
        output.append({'id': card.id, 'front': card.front, 'back': card.back})
    
    return jsonify(output)

# --- DEBUG ROUTE: MAKE ALL DUE (FOR TESTING PURPOSES) ---
@app.route('/api/debug/reset-due', methods=['POST'])
def reset_due_dates():
    try:
        # Set next_review to yesterday for ALL cards
        yesterday = datetime.utcnow() - timedelta(days=1)
        
        # SQL equivalent: UPDATE flashcard SET next_review = 'yesterday'
        Flashcard.query.update({Flashcard.next_review: yesterday})
        
        db.session.commit()
        return jsonify({"message": "All cards are now due!"}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# --- AI ROUTE: SUGGEST LINKS ---
@app.route('/api/ai/suggest', methods=['POST'])
def suggest_links():
    try:
        data = request.json
        # Combine front and back to get full context of the new card
        current_text = f"{data.get('front', '')} {data.get('back', '')}"
        
        # 1. Get all existing cards from DB
        all_cards = Flashcard.query.all()
        if not all_cards:
            return jsonify([])

        # 2. Prepare corpus (list of text from all cards)
        card_texts = [f"{card.front} {card.back}" for card in all_cards]
        card_ids = [card.id for card in all_cards]

        # 3. Encode the current input and the database cards into vectors
        current_embedding = ai_model.encode(current_text, convert_to_tensor=True)
        corpus_embeddings = ai_model.encode(card_texts, convert_to_tensor=True)

        # 4. Calculate Cosine Similarity
        cosine_scores = util.cos_sim(current_embedding, corpus_embeddings)[0]

        # 5. Find top matches
        suggestions = []
        for i, score in enumerate(cosine_scores):
            score_val = score.item()
            
            # Threshold > 0.35 (Relevant) but < 0.99 (Not itself)
            if score_val > 0.35 and score_val < 0.99: 
                suggestions.append({
                    "id": card_ids[i],
                    "front": all_cards[i].front,
                    "back": all_cards[i].back,
                    "score": round(score_val * 100, 1) # Return as percentage
                })

        # Sort by highest score and take top 5
        suggestions = sorted(suggestions, key=lambda x: x['score'], reverse=True)[:5]

        print(f"AI DEBUG: Found {len(suggestions)} matches for '{current_text[:20]}...'")
        return jsonify(suggestions)

    except Exception as e:
        print(f"AI ERROR: {str(e)}")
        return jsonify({"error": str(e)}), 500


# Route to Create Link
@app.route('/api/links', methods=['POST'])
def create_link():
    data = request.json
    source_id = data.get('source_id')
    target_id = data.get('target_id')

    # Prevent linking a card to itself
    if source_id == target_id:
        return jsonify({"error": "Cannot link card to itself"}), 400

    # Create the link
    new_link = SchemaLink(source_card_id=source_id, target_card_id=target_id)
    db.session.add(new_link)
    db.session.commit()

    return jsonify({"message": "Link created successfully!"}), 201


# Route to Delete Card
@app.route('/api/cards/<int:id>', methods=['DELETE'])
def delete_card(id):
    try:
        card = Flashcard.query.get(id)
        if not card:
            return jsonify({"error": "Card not found"}), 404
        
        # Delete associated links first (Foreign Key constraint)
        SchemaLink.query.filter(
            (SchemaLink.source_card_id == id) | (SchemaLink.target_card_id == id)
        ).delete()
        
        # Delete the card
        db.session.delete(card)
        db.session.commit()
        return jsonify({"message": "Card deleted"}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# --- ALGORITHM HELPERS ---

def calculate_sm2(card, grade):
    """
    Standard SM-2 Algorithm Implementation.
    Returns: (New Interval, New Ease Factor)
    """
    # 1. Update Ease Factor (EF)
    q = grade + 1
    new_ef = card.ease_factor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
    if new_ef < 1.3:
        new_ef = 1.3  # Minimum EF cap

    # 2. Update Interval
    if grade == 1:  # "Again" (Fail)
        new_interval = 1.0  # Reset to 1 day
    elif card.interval == 1.0:  # Second review
        new_interval = 6.0
    else:
        new_interval = card.interval * new_ef

    return new_interval, new_ef


# --- ROUTE: SUBMIT REVIEW (THE CORE ALGORITHM) ---
@app.route('/api/reviews', methods=['POST'])
def review_card():
    data = request.json
    card_id = data.get('card_id')
    grade = data.get('grade')
    app_score = data.get('application_score')
    
    # NEW: Check if we should update the due date (Default to True)
    # If False, we only update EF and Interval (for "Again" loops)
    update_schedule = data.get('update_schedule', True)

    card = Flashcard.query.get(card_id)
    if not card:
        return jsonify({"error": "Card not found"}), 404

    old_ef = card.ease_factor
    
    # Step 1: Calculate new stats
    new_interval, new_ef = calculate_sm2(card, grade)

    # Step 2: Apply Innovation (if applicable)
    if card.is_application_card and app_score:
        multipliers = { "High": 1.5, "Medium": 1.0, "Low": 0.5 }
        multiplier = multipliers.get(app_score, 1.0)
        new_interval = new_interval * multiplier
        
        current_history = card.application_score_history or ""
        card.application_score_history = f"{current_history},{app_score}".strip(",")

    # Step 3: Save Math Updates (Always happens)
    card.interval = round(new_interval, 2)
    card.ease_factor = round(new_ef, 2)
    
    # Step 4: Conditional Schedule Update
    # Only push the date forward if it's NOT an "Again" (Grade 1)
    if update_schedule:
        card.next_review = datetime.utcnow() + timedelta(days=new_interval)

    db.session.commit()

    print(f"DEBUG: Reviewed Card {card.id}. Grade: {grade}. EF: {old_ef} -> {card.ease_factor}. Date Updated: {update_schedule}")

    return jsonify({
        "message": "Review saved",
        "new_interval": card.interval,
        "next_due": card.next_review
    })


# --- ROUTE: ANALYTICS (Weakest Links) ---
@app.route('/api/analytics/weakest', methods=['GET'])
def get_weakest_cards():
    try:
        # Find cards with lowest Ease Factor (Hardest cards)
        # We only want cards that have actually been reviewed (interval > 1 or ease_factor != 2.5)
        
        # DEBUG: Print total cards found below threshold
        count = Flashcard.query.filter(Flashcard.ease_factor < 2.5).count()
        print(f"DEBUG: Found {count} weak cards (EF < 2.5).")

        weakest = Flashcard.query.filter(Flashcard.ease_factor < 2.5)\
            .order_by(Flashcard.ease_factor.asc())\
            .limit(5)\
            .all()

        output = []
        for card in weakest:
            output.append({
                'id': card.id,
                'front': card.front,
                'ease_factor': card.ease_factor,
                'next_review': card.next_review
            })
        
        return jsonify(output), 200
    except Exception as e:
        print(f"DEBUG ERROR: {e}")
        return jsonify({"error": str(e)}), 500
# --- ROUTE: UPDATE CARD ---
@app.route('/api/cards/<int:id>', methods=['PUT'])
def update_card(id):
    try:
        card = Flashcard.query.get(id)
        if not card:
            return jsonify({"error": "Card not found"}), 404
        
        data = request.json
        
        # 1. Update Card Fields
        card.front = data.get('front', card.front)
        card.back = data.get('back', card.back)
        card.is_application_card = data.get('is_application_card', card.is_application_card)
        
        # 2. Update Links (Optional: Overwrite links where this card is the SOURCE)
        # We assume the frontend sends the complete list of desired links
        if 'linked_ids' in data:
            # First, remove existing links where this card is the source
            SchemaLink.query.filter_by(source_card_id=id).delete()
            
            # Then add the new links
            for target_id in data['linked_ids']:
                if target_id != id: # Prevent self-linking
                    new_link = SchemaLink(source_card_id=id, target_card_id=target_id)
                    db.session.add(new_link)

        db.session.commit()
        return jsonify({"message": "Card updated successfully!"}), 200
        
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True, port=5000)