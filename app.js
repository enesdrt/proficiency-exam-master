// --- TEMA VE RENK AYARLARI ---
        function toggleTheme() {
            const body = document.body;
            body.classList.toggle('dark-mode');
            const isDark = body.classList.contains('dark-mode');
            
            // Buton metnini güncelle
            document.getElementById('theme-toggle-btn').innerText = isDark ? "☀️ Açık Mod" : "🌙 Koyu Mod";
            
            // Kullanıcı standard temaya geçtiyse özel arka plan rengini sıfırla
            document.body.style.backgroundColor = '';
            
            // Tercihi kaydet
            localStorage.setItem('appTheme', isDark ? 'dark' : 'light');
            localStorage.removeItem('appCustomColor'); 
        }

        document.getElementById('bg-color-picker').addEventListener('input', function(e) {
            const selectedColor = e.target.value;
            // Tüm body (sayfa arkası) rengini değiştir
            document.body.style.backgroundColor = selectedColor;
            // Rengi kaydet
            localStorage.setItem('appCustomColor', selectedColor);
        });

        function loadSavedTheme() {
            const savedTheme = localStorage.getItem('appTheme');
            const savedColor = localStorage.getItem('appCustomColor');

            if (savedTheme === 'dark') {
                document.body.classList.add('dark-mode');
                document.getElementById('theme-toggle-btn').innerText = "☀️ Açık Mod";
            }

            if (savedColor) {
                document.body.style.backgroundColor = savedColor;
                document.getElementById('bg-color-picker').value = savedColor;
            }
        }
        // -----------------------------

        let database = {};
        let currentTopic = "";
        let currentBank = "";
        let currentQuestionIndex = 0;
        let score = 0;
        let userAnswers = [];

        // Firebase bilgilerini buraya dolduracaksın. Boş bırakılırsa site yerel demo modda çalışır.
        const firebaseConfig = {
            apiKey: "AIzaSyB7NFPD8Q86NQvSxO1htrppKESJMcpkXFc",
            authDomain: "proficiency-exam-master.firebaseapp.com",
            projectId: "proficiency-exam-master",
            storageBucket: "proficiency-exam-master.firebasestorage.app",
            messagingSenderId: "1081292201993",
            appId: "1:1081292201993:web:919d51921e39ae234918d8"
        };

        let firebaseReady = false;
        let firebaseModules = {};
        let auth = null;
        let db = null;
        let currentUser = null;
        let usingLocalDemo = false;
        let unknownWords = [];
        let unknownWordSet = new Set();
        let savedNotes = [];
        let noteSaveTimer = null;
        let toastTimer = null;

        function isFirebaseConfigured() {
            return Boolean(firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId && firebaseConfig.appId);
        }

        async function initFirebase() {
            setupNoteAutosave();

            if (!isFirebaseConfigured()) {
                usingLocalDemo = true;
                currentUser = { uid: 'local-demo-user', email: 'Yerel demo modu' };
                document.getElementById('login-btn').disabled = true;
                document.getElementById('register-btn').disabled = true;
                document.getElementById('auth-message').innerText = 'Firebase anahtarları boş olduğu için kayıt/giriş pasif. Notlar ve kelimeler şimdilik bu tarayıcıda saklanıyor.';
                updateAuthUI();
                await loadUnknownWords();
                await loadSavedNotes();
                return;
            }

            try {
                const [appModule, authModule, firestoreModule] = await Promise.all([
                    import('https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js'),
                    import('https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js'),
                    import('https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js')
                ]);

                const app = appModule.initializeApp(firebaseConfig);
                auth = authModule.getAuth(app);
                db = firestoreModule.getFirestore(app);
                firebaseModules = { ...authModule, ...firestoreModule };
                firebaseReady = true;

                authModule.onAuthStateChanged(auth, async (user) => {
                    currentUser = user;
                    updateAuthUI();
                    await loadUnknownWords();
                    await loadSavedNotes();
                    if (currentTopic && currentBank) {
                        await loadCurrentNote();
                        markSavedWords();
                    }
                });
            } catch (error) {
                console.error('Firebase başlatılamadı:', error);
                usingLocalDemo = true;
                currentUser = { uid: 'local-demo-user', email: 'Yerel demo modu' };
                document.getElementById('auth-message').innerText = 'Firebase bağlantısı kurulamadı. Site yerel demo modda çalışıyor.';
                updateAuthUI();
                await loadUnknownWords();
                await loadSavedNotes();
            }
        }

        function updateAuthUI() {
            const signedOut = document.getElementById('auth-signed-out');
            const signedIn = document.getElementById('auth-signed-in');
            const dashboard = document.getElementById('user-dashboard');
            const note = document.getElementById('question-note');

            if (currentUser) {
                signedOut.classList.add('hidden');
                signedIn.classList.remove('hidden');
                dashboard.classList.remove('hidden');
                document.getElementById('user-email-pill').innerText = currentUser.email || 'Kullanıcı';
                document.getElementById('signed-in-message').innerText = usingLocalDemo
                    ? 'Yerel demo modu: notlar ve kelimeler sadece bu tarayıcıda saklanır.'
                    : 'Notların ve kelime listen Firebase hesabına kaydediliyor.';
                if (note) note.disabled = false;
            } else {
                signedOut.classList.remove('hidden');
                signedIn.classList.add('hidden');
                dashboard.classList.add('hidden');
                if (note) note.disabled = true;
                document.getElementById('auth-message').innerText = 'Not ve kelime listesi için giriş yap veya yeni hesap oluştur.';
            }
        }

        async function handleRegister() {
            if (!firebaseReady) {
                showToast('Firebase anahtarları girilmeden kayıt açılamaz.');
                return;
            }
            const email = document.getElementById('auth-email').value.trim();
            const password = document.getElementById('auth-password').value;
            if (!email || password.length < 6) {
                showToast('E-posta ve en az 6 karakterlik şifre gir.');
                return;
            }
            try {
                await firebaseModules.createUserWithEmailAndPassword(auth, email, password);
                showToast('Hesap oluşturuldu.');
            } catch (error) {
                showToast(firebaseErrorMessage(error));
            }
        }

        async function handleLogin() {
            if (!firebaseReady) {
                showToast('Firebase anahtarları girilmeden giriş açılamaz.');
                return;
            }
            const email = document.getElementById('auth-email').value.trim();
            const password = document.getElementById('auth-password').value;
            if (!email || !password) {
                showToast('E-posta ve şifre gir.');
                return;
            }
            try {
                await firebaseModules.signInWithEmailAndPassword(auth, email, password);
                showToast('Giriş yapıldı.');
            } catch (error) {
                showToast(firebaseErrorMessage(error));
            }
        }

        async function handleLogout() {
            if (usingLocalDemo) {
                showToast('Yerel demo modunda çıkış gerekmez.');
                return;
            }
            if (firebaseReady) {
                await firebaseModules.signOut(auth);
                showToast('Çıkış yapıldı.');
            }
        }

        function firebaseErrorMessage(error) {
            const code = error && error.code ? error.code : '';
            if (code.includes('email-already-in-use')) return 'Bu e-posta zaten kayıtlı.';
            if (code.includes('invalid-email')) return 'E-posta adresi geçersiz.';
            if (code.includes('weak-password')) return 'Şifre en az 6 karakter olmalı.';
            if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) return 'E-posta veya şifre hatalı.';
            return 'İşlem tamamlanamadı. Firebase ayarlarını ve kurallarını kontrol et.';
        }

        function getQuestionId() {
            return [currentTopic, currentBank, `q${currentQuestionIndex + 1}`]
                .map((part) => String(part).toLowerCase().replace(/[^a-z0-9ğüşöçıİĞÜŞÖÇ]+/gi, '-').replace(/^-+|-+$/g, ''))
                .join('__');
        }

        function localKey(type, id = '') {
            const userId = currentUser ? currentUser.uid : 'signed-out';
            return `proficiency:${type}:${userId}:${id}`;
        }

        function getLocalNotesIndex() {
            try {
                return JSON.parse(localStorage.getItem(localKey('notesIndex')) || '{}');
            } catch (error) {
                return {};
            }
        }

        function setLocalNotesIndex(index) {
            localStorage.setItem(localKey('notesIndex'), JSON.stringify(index));
        }

        function setupNoteAutosave() {
            const note = document.getElementById('question-note');
            if (!note) return;
            note.addEventListener('input', () => {
                clearTimeout(noteSaveTimer);
                document.getElementById('note-status').innerText = 'Kaydediliyor...';
                noteSaveTimer = setTimeout(saveCurrentNote, 600);
            });
        }

        async function loadCurrentNote() {
            const note = document.getElementById('question-note');
            const status = document.getElementById('note-status');
            if (!note || !status) return;

            if (!currentUser) {
                note.value = '';
                note.disabled = true;
                status.innerText = 'Not almak için giriş yapmalısın.';
                return;
            }

            const questionId = getQuestionId();
            note.disabled = false;
            note.value = '';
            status.innerText = 'Not yükleniyor...';

            try {
                if (firebaseReady && !usingLocalDemo) {
                    const ref = firebaseModules.doc(db, 'users', currentUser.uid, 'questionNotes', questionId);
                    const snap = await firebaseModules.getDoc(ref);
                    if (questionId === getQuestionId()) note.value = snap.exists() ? (snap.data().note || '') : '';
                } else {
                    note.value = localStorage.getItem(localKey('note', questionId)) || '';
                }
                status.innerText = note.value ? 'Notun yüklendi.' : 'Bu soru için henüz not yok.';
            } catch (error) {
                console.error(error);
                status.innerText = 'Not yüklenemedi.';
            }
        }

        async function saveCurrentNote() {
            const note = document.getElementById('question-note');
            const status = document.getElementById('note-status');
            if (!note || !status || !currentUser || !currentTopic || !currentBank) return;

            const questionId = getQuestionId();
            const qData = database[currentTopic].questionBanks[currentBank][currentQuestionIndex];
            const payload = {
                note: note.value,
                topic: currentTopic,
                bank: currentBank,
                questionIndex: currentQuestionIndex,
                questionText: qData.q,
                updatedAt: new Date().toISOString()
            };

            try {
                const hasNote = note.value.trim().length > 0;
                if (firebaseReady && !usingLocalDemo) {
                    const noteRef = firebaseModules.doc(db, 'users', currentUser.uid, 'questionNotes', questionId);
                    if (hasNote) {
                        await firebaseModules.setDoc(
                            noteRef,
                            { ...payload, updatedAt: firebaseModules.serverTimestamp() },
                            { merge: true }
                        );
                    } else {
                        await firebaseModules.deleteDoc(noteRef);
                    }
                } else {
                    const localNotes = getLocalNotesIndex();
                    if (hasNote) {
                        localStorage.setItem(localKey('note', questionId), note.value);
                        localNotes[questionId] = { id: questionId, ...payload };
                    } else {
                        localStorage.removeItem(localKey('note', questionId));
                        delete localNotes[questionId];
                    }
                    setLocalNotesIndex(localNotes);
                }
                syncSavedNote(questionId, payload);
                status.innerText = 'Not kaydedildi.';
            } catch (error) {
                console.error(error);
                status.innerText = 'Not kaydedilemedi.';
            }
        }

        async function loadSavedNotes() {
            if (!currentUser) {
                savedNotes = [];
                renderSavedNotes();
                return;
            }

            try {
                if (firebaseReady && !usingLocalDemo) {
                    const col = firebaseModules.collection(db, 'users', currentUser.uid, 'questionNotes');
                    const snap = await firebaseModules.getDocs(col);
                    savedNotes = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
                } else {
                    savedNotes = Object.values(getLocalNotesIndex());
                }
            } catch (error) {
                console.error(error);
                savedNotes = [];
            }

            normalizeSavedNotes();
            renderSavedNotes();
        }

        function syncSavedNote(questionId, payload) {
            savedNotes = savedNotes.filter((item) => item.id !== questionId);
            if (String(payload.note || '').trim()) {
                savedNotes.push({ id: questionId, ...payload, updatedAt: new Date().toISOString() });
            }
            normalizeSavedNotes();
            renderSavedNotes();
        }

        function normalizeSavedNotes() {
            savedNotes = savedNotes
                .filter((item) => item && String(item.note || '').trim())
                .sort((a, b) => noteTimeValue(b) - noteTimeValue(a));
        }

        function noteTimeValue(item) {
            const value = item && item.updatedAt;
            if (!value) return 0;
            if (typeof value.toMillis === 'function') return value.toMillis();
            if (typeof value.seconds === 'number') return value.seconds * 1000;
            const parsed = Date.parse(value);
            return Number.isNaN(parsed) ? 0 : parsed;
        }

        function renderSavedNotes() {
            const container = document.getElementById('notes-list');
            if (!container) return;
            container.innerHTML = '';

            if (!currentUser) {
                container.appendChild(emptyState('Notlarını görmek için giriş yapmalısın.'));
                return;
            }

            if (savedNotes.length === 0) {
                container.appendChild(emptyState('Henüz not aldığın soru yok.'));
                return;
            }

            savedNotes.forEach((item) => {
                const card = document.createElement('article');
                card.className = 'note-card';

                const questionNumber = Number(item.questionIndex) + 1;
                const title = document.createElement('div');
                title.className = 'note-card-title';
                title.textContent = `${item.topic || 'Bölüm'} / ${item.bank || 'Test'} / Soru ${Number.isFinite(questionNumber) ? questionNumber : '-'}`;

                const meta = document.createElement('div');
                meta.className = 'note-meta';
                meta.textContent = formatNoteDate(item);

                const question = document.createElement('div');
                question.className = 'note-question';
                question.textContent = truncateText(item.questionText || 'Soru metni kaydedilmemiş.', 220);

                const noteText = document.createElement('div');
                noteText.className = 'note-text';
                noteText.textContent = item.note || '';

                const openButton = document.createElement('button');
                openButton.className = 'note-open-btn';
                openButton.type = 'button';
                openButton.textContent = 'Soruyu Aç';
                openButton.onclick = () => openSavedQuestion(item.topic, item.bank, Number(item.questionIndex));

                card.appendChild(title);
                card.appendChild(meta);
                card.appendChild(question);
                card.appendChild(noteText);
                card.appendChild(openButton);
                container.appendChild(card);
            });
        }

        function emptyState(message) {
            const state = document.createElement('div');
            state.className = 'auth-message';
            state.textContent = message;
            return state;
        }

        function formatNoteDate(item) {
            const value = noteTimeValue(item);
            if (!value) return 'Tarih bilgisi yok';
            return `Son güncelleme: ${new Date(value).toLocaleString('tr-TR')}`;
        }

        function stripHtml(value) {
            return String(value || '').replace(/<[^>]*>/g, ' ');
        }

        function truncateText(value, maxLength) {
            const text = stripHtml(value).replace(/\s+/g, ' ').trim();
            if (text.length <= maxLength) return text;
            return `${text.slice(0, maxLength).trim()}...`;
        }

        async function loadUnknownWords() {
            if (!currentUser) {
                unknownWords = [];
                unknownWordSet = new Set();
                renderUnknownWords();
                return;
            }

            try {
                if (firebaseReady && !usingLocalDemo) {
                    const col = firebaseModules.collection(db, 'users', currentUser.uid, 'unknownWords');
                    const snap = await firebaseModules.getDocs(col);
                    unknownWords = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
                } else {
                    unknownWords = JSON.parse(localStorage.getItem(localKey('words')) || '[]');
                }
            } catch (error) {
                console.error(error);
                unknownWords = [];
            }

            unknownWords.sort((a, b) => String(a.word || '').localeCompare(String(b.word || '')));
            unknownWordSet = new Set(unknownWords.map((item) => normalizeWord(item.word)));
            renderUnknownWords();
            markSavedWords();
        }

        async function addUnknownWord(rawWord) {
            if (!currentUser) {
                showToast('Kelime kaydetmek için giriş yapmalısın.');
                return;
            }

            const word = cleanWord(rawWord);
            const normalized = normalizeWord(word);
            if (!normalized || normalized.length < 2) return;
            if (unknownWordSet.has(normalized)) {
                showToast(`"${word}" zaten kelime listende.`);
                return;
            }

            const qData = currentTopic && currentBank ? database[currentTopic].questionBanks[currentBank][currentQuestionIndex] : {};
            const item = {
                id: safeDocId(normalized),
                word,
                normalized,
                topic: currentTopic || '',
                bank: currentBank || '',
                questionIndex: currentQuestionIndex,
                sourceQuestionId: currentTopic && currentBank ? getQuestionId() : '',
                sourceQuestion: qData.q || '',
                addedAt: new Date().toISOString()
            };

            try {
                if (firebaseReady && !usingLocalDemo) {
                    await firebaseModules.setDoc(
                        firebaseModules.doc(db, 'users', currentUser.uid, 'unknownWords', item.id),
                        { ...item, addedAt: firebaseModules.serverTimestamp() },
                        { merge: true }
                    );
                } else {
                    const map = new Map(unknownWords.map((stored) => [stored.normalized, stored]));
                    map.set(normalized, item);
                    localStorage.setItem(localKey('words'), JSON.stringify(Array.from(map.values())));
                }
                await loadUnknownWords();
                showToast(`"${word}" kelime listene eklendi.`);
            } catch (error) {
                console.error(error);
                showToast('Kelime kaydedilemedi.');
            }
        }

        async function removeUnknownWord(wordId) {
            if (!currentUser) return;
            const decoded = decodeURIComponent(wordId);

            try {
                if (firebaseReady && !usingLocalDemo) {
                    await firebaseModules.deleteDoc(firebaseModules.doc(db, 'users', currentUser.uid, 'unknownWords', wordId));
                } else {
                    unknownWords = unknownWords.filter((item) => item.id !== wordId && item.normalized !== decoded);
                    localStorage.setItem(localKey('words'), JSON.stringify(unknownWords));
                }
                await loadUnknownWords();
                showToast('Kelime listeden çıkarıldı.');
            } catch (error) {
                console.error(error);
                showToast('Kelime silinemedi.');
            }
        }

        function renderUnknownWords() {
            const containers = [
                document.getElementById('dashboard-words-list'),
                document.getElementById('quiz-words-list'),
                document.getElementById('words-screen-list')
            ];
            for (const container of containers) {
                if (!container) continue;
                container.innerHTML = '';
                if (!currentUser) {
                    container.innerHTML = '<span class="auth-message">Liste için giriş yapmalısın.</span>';
                    continue;
                }
                if (unknownWords.length === 0) {
                    container.innerHTML = '<span class="auth-message">Henüz kelime eklenmedi.</span>';
                    continue;
                }
                unknownWords.forEach((item) => {
                    const chip = document.createElement('span');
                    chip.className = 'word-chip';
                    chip.innerHTML = `<span>${escapeHtml(item.word)}</span>`;
                    const remove = document.createElement('button');
                    remove.className = 'word-remove';
                    remove.type = 'button';
                    remove.innerText = '×';
                    remove.title = 'Kelimeyi sil';
                    remove.onclick = () => removeUnknownWord(item.id || safeDocId(item.normalized));
                    chip.appendChild(remove);
                    container.appendChild(chip);
                });
            }
        }

        function makeWordsClickable(root) {
            if (!root) return;
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
                acceptNode(node) {
                    if (!node.nodeValue || !/[A-Za-z]/.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
                    if (node.parentElement && node.parentElement.closest('.word-token, textarea, input')) return NodeFilter.FILTER_REJECT;
                    return NodeFilter.FILTER_ACCEPT;
                }
            });

            const nodes = [];
            while (walker.nextNode()) nodes.push(walker.currentNode);

            nodes.forEach((node) => {
                const fragment = document.createDocumentFragment();
                const text = node.nodeValue;
                const regex = /[A-Za-z][A-Za-z'’.-]*[A-Za-z]/g;
                let lastIndex = 0;
                let match;

                while ((match = regex.exec(text)) !== null) {
                    fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
                    const span = document.createElement('span');
                    span.className = 'word-token';
                    span.dataset.word = match[0];
                    span.title = 'Kelime listesine eklemek için sağ tıkla';
                    span.textContent = match[0];
                    span.addEventListener('contextmenu', (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        addUnknownWord(span.dataset.word);
                    });
                    fragment.appendChild(span);
                    lastIndex = regex.lastIndex;
                }

                fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
                node.parentNode.replaceChild(fragment, node);
            });

            markSavedWords(root);
        }

        function markSavedWords(root = document) {
            root.querySelectorAll('.word-token').forEach((token) => {
                const normalized = normalizeWord(token.dataset.word);
                token.classList.toggle('saved-word', unknownWordSet.has(normalized));
            });
        }

        function cleanWord(value) {
            return String(value || '').replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '');
        }

        function normalizeWord(value) {
            return cleanWord(value).toLowerCase();
        }

        function safeDocId(value) {
            return encodeURIComponent(String(value || '').toLowerCase());
        }

        function escapeHtml(value) {
            return String(value ?? '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        }

        function showToast(message) {
            const toast = document.getElementById('toast');
            if (!toast) return;
            clearTimeout(toastTimer);
            toast.innerText = message;
            toast.classList.add('visible');
            toastTimer = setTimeout(() => toast.classList.remove('visible'), 2200);
        }

        function showScreen(screenId) {
            ['screen-topics', 'screen-words', 'screen-notes', 'screen-banks', 'screen-quiz', 'screen-score'].forEach((id) => {
                const screen = document.getElementById(id);
                if (screen) screen.classList.add('hidden');
            });
            
            document.getElementById(screenId).classList.remove('hidden');

            if(screenId === 'screen-quiz') {
                document.getElementById('header-left-controls').style.display = 'flex';
                document.getElementById('header-right-controls').style.display = 'flex';
            } else {
                document.getElementById('header-left-controls').style.display = 'none';
                document.getElementById('header-right-controls').style.display = 'none';
            }
        }

        window.onload = async function() {
            // Kaydedilmiş temayı yükle
            loadSavedTheme();
            await initFirebase();

            try {
                const response = await fetch('data.json');
                if (!response.ok) throw new Error("Veri dosyası bulunamadı!");
                database = await response.json();
                
                document.getElementById('loading-text').innerText = "Lütfen çalışmak istediğiniz bölümü seçin";
                const container = document.getElementById('topics-container');
                container.innerHTML = '';
                
                for (let topic in database) {
                    let btn = document.createElement('button');
                    btn.className = 'topic-btn';
                    btn.innerText = topic;
                    btn.onclick = () => selectTopic(topic);
                    container.appendChild(btn);
                }
            } catch (error) {
                console.error("Hata:", error);
                document.getElementById('loading-text').innerHTML = "<span style='color:red;'>Veriler yüklenemedi. Lütfen 'Live Server' kullanın.</span>";
            }
        };

        function selectTopic(topic) {
            currentTopic = topic;
            showBanks();
        }

        function goHome() {
            showScreen('screen-topics');
        }

        async function showWordsScreen() {
            showScreen('screen-words');
            await loadUnknownWords();
        }

        async function showNotesScreen() {
            showScreen('screen-notes');
            await loadSavedNotes();
        }

        function openSavedQuestion(topic, bank, questionIndex) {
            if (!topic || !bank || !database[topic] || !database[topic].questionBanks || !database[topic].questionBanks[bank]) {
                showToast('Bu notun bağlı olduğu test bulunamadı.');
                return;
            }

            const questions = database[topic].questionBanks[bank];
            const targetIndex = Number.isFinite(questionIndex) ? questionIndex : 0;
            if (!questions[targetIndex]) {
                showToast('Bu notun bağlı olduğu soru bulunamadı.');
                return;
            }

            currentTopic = topic;
            currentBank = bank;
            currentQuestionIndex = targetIndex;
            score = 0;
            userAnswers = new Array(questions.length).fill(null);

            showScreen('screen-quiz');
            loadQuestion();
        }

        function showBanks() {
            document.getElementById('selected-topic-banks-title').innerText = currentTopic;
            const container = document.getElementById('banks-container');
            container.innerHTML = '';
            
            const banks = database[currentTopic].questionBanks;
            
            for (let bankName in banks) {
                let btn = document.createElement('button');
                btn.className = 'mode-btn quiz';
                let questionCount = banks[bankName].length;
                
                if (questionCount === 0) {
                    btn.innerText = bankName + " (Soru Bulunamadı)";
                    btn.disabled = true;
                } else {
                    btn.innerText = bankName + " (" + questionCount + " Soru)";
                    btn.onclick = () => startQuiz(bankName);
                }
                container.appendChild(btn);
            }
            showScreen('screen-banks');
        }

        function startQuiz(selectedBank) {
            currentBank = selectedBank;
            currentQuestionIndex = 0;
            score = 0;
            
            const totalQ = database[currentTopic].questionBanks[currentBank].length;
            userAnswers = new Array(totalQ).fill(null); 
            
            showScreen('screen-quiz');
            loadQuestion();
        }

        function loadQuestion() {
            const qData = database[currentTopic].questionBanks[currentBank][currentQuestionIndex];
            const totalQ = database[currentTopic].questionBanks[currentBank].length;
            
            document.getElementById('prev-btn').disabled = (currentQuestionIndex === 0);
            
            if (currentQuestionIndex === totalQ - 1) {
                document.getElementById('next-btn').innerText = "Testi Bitir";
            } else {
                document.getElementById('next-btn').innerText = "Sonraki";
            }
            
            document.getElementById('quiz-progress').innerText = `Soru ${currentQuestionIndex + 1} / ${totalQ} (${currentBank})`;
            
            const contextBox = document.getElementById('context-box');
            if (qData.context) {
                contextBox.innerHTML = qData.context;
                contextBox.style.display = 'block';
                makeWordsClickable(contextBox);
            } else {
                contextBox.style.display = 'none';
            }

            const questionText = document.getElementById('question-text');
            questionText.innerHTML = qData.q;
            makeWordsClickable(questionText);
            
            const optionsContainer = document.getElementById('options-container');
            optionsContainer.innerHTML = ''; 

            qData.options.forEach((opt, index) => {
                let btn = document.createElement('button');
                btn.className = 'option';
                btn.innerHTML = escapeHtml(opt);
                makeWordsClickable(btn);
                
                if (userAnswers[currentQuestionIndex] !== null) {
                    btn.disabled = true;
                    if (index === qData.correct) {
                        btn.classList.add('correct');
                    } else if (index === userAnswers[currentQuestionIndex]) {
                        btn.classList.add('incorrect');
                    }
                } else {
                    btn.onclick = () => checkAnswer(index, btn);
                }
                
                optionsContainer.appendChild(btn);
            });

            if (userAnswers[currentQuestionIndex] !== null) {
                document.getElementById('explanation-text').innerHTML = qData.explanation;
                makeWordsClickable(document.getElementById('explanation-text'));
                document.getElementById('explanation-box').style.display = 'block';
            } else {
                document.getElementById('explanation-box').style.display = 'none';
            }
            loadCurrentNote();
        }

        function checkAnswer(selectedIndex, btnElement) {
            const qData = database[currentTopic].questionBanks[currentBank][currentQuestionIndex];
            const allBtns = document.getElementById('options-container').children;
            
            userAnswers[currentQuestionIndex] = selectedIndex;

            for(let i=0; i<allBtns.length; i++) {
                allBtns[i].disabled = true;
                if(i === qData.correct) {
                    allBtns[i].classList.add('correct');
                }
            }

            if(selectedIndex === qData.correct) {
                score++;
            } else {
                btnElement.classList.add('incorrect');
            }

            document.getElementById('explanation-text').innerHTML = qData.explanation;
            makeWordsClickable(document.getElementById('explanation-text'));
            document.getElementById('explanation-box').style.display = 'block';
        }

        function prevQuestion() {
            if(currentQuestionIndex > 0) {
                currentQuestionIndex--;
                loadQuestion();
            }
        }

        function nextQuestion() {
            const totalQ = database[currentTopic].questionBanks[currentBank].length;
            if(currentQuestionIndex < totalQ - 1) {
                currentQuestionIndex++;
                loadQuestion();
            } else {
                endQuiz();
            }
        }

        function endQuiz() {
            const totalQ = database[currentTopic].questionBanks[currentBank].length;
            document.getElementById('score-text').innerHTML = `<strong>${totalQ}</strong> sorudan <strong>${score}</strong> tanesini doğru cevapladınız.`;
            showScreen('screen-score');
        }
