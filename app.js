// Kira-CEO Brooklyn - Frontend Application
// GitHub Pages Static Frontend with Supabase Integration

// ============================================================
// Configuration
// ============================================================

const SUPABASE_URL = 'https://fevyzpgayxohhopfpjxp.supabase.co';
const SUPABASE_ANON_KEY_ENDPOINT = `${SUPABASE_URL}/functions/v1/brooklyn-config`;
const BOOKING_ENDPOINT = `${SUPABASE_URL}/functions/v1/brooklyn-booking`;
const INTERNAL_ENDPOINT = `${SUPABASE_URL}/functions/v1/brooklyn-internal`;
const MAPS_URL = 'https://maps.app.goo.gl/x4sgYuXCZhRhZHGK7?g_st=ac';
const APP_BASE_URL = 'https://kira0888.github.io/kira-ceo-brooklyn/';

const INITIAL_AUTH_HASH = window.location.hash;
const INITIAL_PASSWORD_RECOVERY =
    new URLSearchParams(INITIAL_AUTH_HASH.replace(/^#/, '')).get('type') === 'recovery';

const KNOWN_ROUTES = new Set([
    'home',
    'agendamento',
    'agenda',
    'financeiro',
    'relatorios',
    'configuracoes',
    'localizacao',
    'acesso-interno',
    'redefinir-senha'
]);

// ============================================================
// State Management
// ============================================================

let appState = {
    supabaseConfig: null,
    supabaseClient: null,
    currentUser: null,
    currentSession: null,
    currentPage: 'home',
    bookingState: {
        mode: 'live',
        service: null,
        professional: null,
        date: null,
        appointment: null,
        managementToken: null,
        tenant: null,
        selectedSlot: null
    },
    workspaceData: null,
    userRole: null,
    passwordRecoveryMode: INITIAL_PASSWORD_RECOVERY,
    services: [],
    professionals: []
};

// Make appState accessible globally
window.appState = appState;

// KIRA_PUBLIC_BOOKING_SAFETY_V22_1
const publicBookingMutationState = {
    pending: false,
    idempotencyKey: null,
    payloadSignature: null
};

function isExplicitBookingDemo() {
    return new URLSearchParams(window.location.search).get('demo') === '1';
}



// KIRA_FRONTEND_SECURITY_V23_1
function clearSupabaseAuthTokensFromUrl() {
    const hash = window.location.hash || '';

    if (
        !hash.includes('access_token=') &&
        !hash.includes('refresh_token=') &&
        !hash.includes('type=recovery')
    ) {
        return;
    }

    window.history.replaceState(
        null,
        document.title,
        `${window.location.pathname}${window.location.search}`
    );
}

// ============================================================
// Initialization
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
});

async function initializeApp() {
    try {
        // Load Supabase configuration
        await loadSupabaseConfig();
        
        // Setup auth state listener
        setupAuthStateListener();
        
        // Check for existing session
        await checkSession();
        
        // Setup navigation
        setupNavigation();
        
        // Recovery links return session data inside the URL hash.
        // Never interpret Supabase auth tokens as an application route.
        clearSupabaseAuthTokensFromUrl();

        const initialRoute = window.location.hash.slice(1);

        if (appState.passwordRecoveryMode && appState.currentSession) {
            navigateTo('redefinir-senha');
        } else {
            navigateTo(KNOWN_ROUTES.has(initialRoute) ? initialRoute : 'home');
        }

        window.addEventListener('hashchange', () => {
            const hash = window.location.hash.slice(1);

            if (
                hash.includes('access_token=') ||
                hash.includes('refresh_token=') ||
                hash.includes('type=recovery')
            ) {
                return;
            }

            if (KNOWN_ROUTES.has(hash)) {
                navigateTo(hash);
            }
        });
    } catch (error) {
        console.error('Initialization error:', error);
        showAlert('Erro ao inicializar aplicação', 'error');
    }
}

async function loadSupabaseConfig() {
    try {
        const response = await fetch(SUPABASE_ANON_KEY_ENDPOINT);
        if (!response.ok) throw new Error('Failed to load config');
        
        appState.supabaseConfig = await response.json();
        
        // Initialize Supabase client
        const { createClient } = window.supabase;
        appState.supabaseClient = createClient(
            appState.supabaseConfig.url,
            appState.supabaseConfig.key,
            {
                auth: {
                    detectSessionInUrl: true,
                    persistSession: true,
                    storage: window.sessionStorage,
                    flowType: 'implicit'
                }
            }
        );
    } catch (error) {
        console.error('Config load error:', error);
        throw error;
    }
}

// BROOKLYN_OWNER_ACCESS_V7
function setupAuthStateListener() {
    if (!appState.supabaseClient) return;

    appState.supabaseClient.auth.onAuthStateChange((event, session) => {
        appState.currentSession = session;
        appState.currentUser = session?.user || null;
        updateUserInfo();
        updateNavigationByRole();

        if (event === 'PASSWORD_RECOVERY') {
            appState.passwordRecoveryMode = true;
            appState.workspaceData = null;
            appState.userRole = null;
            navigateTo('redefinir-senha');
            return;
        }

        if (event === 'SIGNED_OUT') {
            appState.workspaceData = null;
            appState.userRole = null;
            updateNavigationByRole();
            navigateTo('home');
            return;
        }

        if (event === 'SIGNED_IN') {
            // The explicit login owns workspace loading and navigation.
            if (loginRequestPending) return;

            if (appState.passwordRecoveryMode) {
                navigateTo('redefinir-senha');
                return;
            }

            ensureWorkspaceAccess().then(ok => {
                updateNavigationByRole();
                if (appState.currentPage === 'acesso-interno') {
                    if (ok) renderLoggedInAuth();
                    else renderAccessRecoveryState();
                }
            });
        }
    });
}

async function ensureWorkspaceAccess() {
    if (!appState.currentSession) return false;

    for (let attempt = 0; attempt < 2; attempt++) {
        const ok = await loadWorkspaceData(attempt === 0);
        if (ok && appState.userRole) return true;

        try {
            const { data, error } = await appState.supabaseClient.auth.refreshSession();
            if (!error && data?.session) {
                appState.currentSession = data.session;
                appState.currentUser = data.session.user;
            }
        } catch (error) {
            console.warn('Session refresh failed:', error);
        }
    }

    return Boolean(appState.userRole);
}

function updateNavigationByRole() {
    const navConfigs = document.getElementById('nav-configuracoes');
    if (!navConfigs) return;
    navConfigs.style.display = (appState.currentUser && ['OWNER', 'RECEPTION'].includes(appState.userRole)) ? '' : 'none';
}


async function checkSession() {
    try {
        if (!appState.supabaseClient) return;

        const { data: { session } } = await appState.supabaseClient.auth.getSession();
        appState.currentSession = session;
        appState.currentUser = session?.user || null;

        if (session) {
            if (appState.passwordRecoveryMode) {
                appState.workspaceData = null;
                appState.userRole = null;
            } else {
                await loadWorkspaceData();
            }
        } else {
            appState.workspaceData = null;
            appState.userRole = null;
        }

        updateUserInfo();
        updateNavigationByRole();
    } catch (error) {
        console.error('Session check error:', error);
        appState.workspaceData = null;
        appState.userRole = null;
        updateNavigationByRole();
    }
}

async function performWorkspaceLoad(allowRefresh = true) {
    try {
        if (!appState.currentSession) {
            appState.workspaceData = null;
            appState.userRole = null;
            updateNavigationByRole();
            return false;
        }

        const response = await fetch(`${INTERNAL_ENDPOINT}?mode=workspace`, {
            headers: {
                'Authorization': `Bearer ${appState.currentSession.access_token}`,
                'apikey': appState.supabaseConfig.key
            }
        });

        if (response.status === 401 && allowRefresh) {
            const { data, error } = await appState.supabaseClient.auth.refreshSession();
            if (!error && data?.session) {
                appState.currentSession = data.session;
                appState.currentUser = data.session.user;
                return performWorkspaceLoad(false);
            }
        }

        if (response.status === 401 || response.status === 403) {
            appState.workspaceData = null;
            appState.userRole = null;
            updateNavigationByRole();
            return false;
        }

        if (!response.ok) {
            throw new Error(`Workspace HTTP ${response.status}`);
        }

        appState.workspaceData = await response.json();
        appState.userRole = appState.workspaceData.role || null;
        updateNavigationByRole();
        updateUserInfo();
        return Boolean(appState.userRole);
    } catch (error) {
        console.error('Workspace load error:', error);
        appState.workspaceData = null;
        appState.userRole = null;
        updateNavigationByRole();
        return false;
    }
}


let workspaceLoadPromise = null;

async function loadWorkspaceData(allowRefresh = true) {
    if (workspaceLoadPromise) {
        return workspaceLoadPromise;
    }

    workspaceLoadPromise = performWorkspaceLoad(allowRefresh);

    try {
        return await workspaceLoadPromise;
    } finally {
        workspaceLoadPromise = null;
    }
}

function updateUserInfo() {
    const userInfoEl = document.getElementById('user-info');
    if (!userInfoEl) return;

    if (appState.currentUser?.email) {
        userInfoEl.textContent = sanitizeText(appState.currentUser.email);
    } else {
        userInfoEl.textContent = 'Não autenticado';
    }
}

// ============================================================
// Navigation & Routing
// ============================================================

function setupNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const page = item.dataset.page;
            navigateTo(page);
            closeMobileMenu();
        });
    });
}

function navigateTo(page) {
    appState.currentPage = page;
    
    // Update active nav item
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.page === page) {
            item.classList.add('active');
        }
    });

    // Render page
    renderPage(page);
    
    // Update URL
    window.location.hash = page;
}

function renderPage(page) {
    const content = document.getElementById('content');

    // BROOKLYN_EDITORIAL_V3
    const publicPage = !appState.currentUser && ['home', 'agendamento', 'localizacao'].includes(page);
    document.body.classList.toggle('public-shell', publicPage);
    
    // Check authentication for protected pages
    const protectedPages = ['agenda', 'financeiro', 'relatorios', 'configuracoes'];
    if (protectedPages.includes(page) && !appState.currentUser) {
        navigateTo('acesso-interno');
        return;
    }

    switch(page) {
        case 'redefinir-senha':
            renderPasswordUpdateForm();
            break;
        case 'home':
            renderHomePage();
            break;
        case 'agendamento':
            renderBookingPage();
            break;
        case 'agenda':
            if (appState.currentUser) renderSchedulePage();
            else navigateTo('acesso-interno');
            break;
        case 'financeiro':
            if (appState.currentUser && ['OWNER', 'RECEPTION'].includes(appState.userRole)) {
                renderFinancialPage();
            } else {
                showAlert('Acesso negado', 'error');
                navigateTo('home');
            }
            break;
        case 'relatorios':
            if (appState.currentUser && appState.userRole === 'OWNER') {
                renderReportsPage();
            } else {
                showAlert('Acesso negado', 'error');
                navigateTo('home');
            }
            break;
        case 'localizacao':
            renderLocationPage();
            break;
        case 'configuracoes':
            if (appState.currentUser && ['OWNER', 'RECEPTION'].includes(appState.userRole)) {
                renderConfigurationPage();
            } else {
                showAlert('Acesso negado', 'error');
                navigateTo('home');
            }
            break;
        case 'acesso-interno':
            renderAuthPage();
            break;
        default:
            renderHomePage();
    }
}

// ============================================================
// Public Pages
// ============================================================

// BROOKLYN_PRO_UI_V4
// BROOKLYN_VISUAL_REFINE_V6
// BROOKLYN_HOME_EDITORIAL_V12
function renderHomePage() {
    if (appState.currentUser && appState.userRole) {
        renderOwnerDashboardPage();
        return;
    }

    const content = document.getElementById('content');
    updateTopbar('Início', 'Barbearia Brooklyn · QS 121');

    content.innerHTML = `
        <div class="content-inner brooklyn-public brooklyn-home-v12">
            <section class="brooklyn-hero-v12" aria-label="Barbearia Brooklyn">
                <figure class="brooklyn-hero-photo-v12">
                    <img src="./assets/brooklyn-hero.jpg" alt="Barbeiro realizando um corte">
                    <div class="brooklyn-photo-shade-v12"></div>

                    <div class="brooklyn-photo-brand-v12">
                        <span class="brooklyn-photo-mark-v12">♛</span>
                        <div>
                            <small>BARBEARIA</small>
                            <strong>BROOKLYN</strong>
                        </div>
                    </div>

                    <div class="brooklyn-photo-unit-v12">
                        <small>UNIDADE</small>
                        <strong>QS 121</strong>
                        <span>Samambaia · Brasília/DF</span>
                    </div>
                </figure>

                <div class="brooklyn-hero-copy-v12">
                    <div class="brooklyn-hero-meta-v12">
                        <span>BROOKLYN / QS 121</span>
                        <span>KIRA-CEO</span>
                    </div>

                    <div class="brooklyn-hero-main-v12">
                        <span class="brooklyn-kicker-v12">AGENDAMENTO DIGITAL</span>

                        <h1>
                            <span>SEU HORÁRIO.</span>
                            <span>SEU CORTE.</span>
                            <em>BROOKLYN.</em>
                        </h1>

                        <p>
                            Agende seu atendimento na unidade QS 121 com uma experiência direta,
                            clara e pensada para funcionar bem em qualquer tela.
                        </p>

                        <div class="brooklyn-actions-v12">
                            <a href="#agendamento" class="editorial-cta">
                                <span>AGENDAR AGORA</span>
                                <b>↗</b>
                            </a>

                            <a href="#localizacao" class="editorial-ghost-link">
                                COMO CHEGAR <span>↗</span>
                            </a>
                        </div>
                    </div>

                    <div class="brooklyn-hero-foot-v12">
                        <div>
                            <small>UNIDADE</small>
                            <strong>QS 121</strong>
                        </div>
                        <div>
                            <small>REGIÃO</small>
                            <strong>SAMAMBAIA</strong>
                        </div>
                    </div>
                </div>
            </section>

            <section class="brooklyn-editorial-v12" aria-label="Experiência Brooklyn">
                <div class="brooklyn-editorial-heading-v12">
                    <span class="brooklyn-kicker-v12">BROOKLYN / EXPERIÊNCIA</span>
                    <h2>A EXPERIÊNCIA COMEÇA <em>ANTES DA CADEIRA.</em></h2>
                </div>

                <div class="brooklyn-editorial-copy-v12">
                    <p>
                        Menos ruído, menos etapas e uma presença visual que acompanha a identidade
                        da Brooklyn sem parecer um template de software.
                    </p>

                    <div class="brooklyn-editorial-lines-v12">
                        <div>
                            <span>01</span>
                            <strong>AGENDAMENTO</strong>
                            <small>Serviço, profissional, data e horário em uma jornada objetiva.</small>
                        </div>
                        <div>
                            <span>02</span>
                            <strong>LOCALIZAÇÃO</strong>
                            <small>Rota da unidade QS 121 acessível sem quebrar a experiência.</small>
                        </div>
                        <div>
                            <span>03</span>
                            <strong>GESTÃO</strong>
                            <small>Área interna separada da experiência pública do cliente.</small>
                        </div>
                    </div>
                </div>
            </section>

            <section class="brooklyn-signature-v12" aria-label="Identidade Brooklyn">
                <div>
                    <span>QS 121</span>
                    <strong>SAMAMBAIA · BRASÍLIA/DF</strong>
                </div>
                <p>BARBEARIA BROOKLYN</p>
            </section>

            <footer class="public-footer brooklyn-footer-v12">
                <a href="#acesso-interno" class="public-staff-link">ÁREA DA EQUIPE ↗</a>
                <span>GESTÃO DIGITAL KIRA-CEO</span>
            </footer>
        </div>
    `;
}

// BROOKLYN_RUNTIME_FIX_V11
async function renderOwnerDashboardPage() {
    const content = document.getElementById('content');
    updateTopbar('Visão geral', 'Operação Brooklyn · QS 121');

    content.innerHTML = `
        <div class="content-inner">
            <div class="ops-loading">
                <div class="loading"></div>
                <span>Carregando operação...</span>
            </div>
        </div>
    `;

    try {
        if (!appState.workspaceData) {
            await loadWorkspaceData();
        }

        const ws = appState.workspaceData || {};
        const agenda = ws.agenda || [];
        const services = ws.services || [];
        const professionals = ws.professionals || [];
        const financial = ws.financial || {};
        const orders = financial.orders || [];
        const cash = financial.cash || [];
        const commission = financial.commission || [];

        const todayKey = new Date().toLocaleDateString('sv-SE', {
            timeZone: 'America/Sao_Paulo'
        });

        const todayAgenda = agenda.filter(item =>
            new Date(item.starts_at).toLocaleDateString('sv-SE', {
                timeZone: 'America/Sao_Paulo'
            }) === todayKey
        );

        const receivedCents = orders.reduce(
            (sum, order) => sum + Number(order.paid_cents || 0), 0
        );
        const dueCents = orders.reduce(
            (sum, order) => sum + Number(order.balance_cents || 0), 0
        );
        const commissionCents = commission.reduce(
            (sum, item) => sum + Number(item.payable_cents || 0), 0
        );
        const openCash = cash.find(session => session.status === 'OPEN') || null;

        const stateLabels = {
            BOOKED: 'Agendado',
            CONFIRMED: 'Confirmado',
            IN_SERVICE: 'Em atendimento',
            COMPLETED: 'Concluído',
            NO_SHOW: 'Faltou',
            CANCELLED: 'Cancelado',
            BLOCKED: 'Bloqueio'
        };

        const agendaCards = todayAgenda.length
            ? todayAgenda.map(item => {
                const time = new Date(item.starts_at).toLocaleTimeString('pt-BR', {
                    hour: '2-digit',
                    minute: '2-digit',
                    timeZone: 'America/Sao_Paulo'
                });

                return `
                    <div class="ops-appointment">
                        <div class="ops-time">${time}</div>
                        <div class="ops-appt-main">
                            <strong>${sanitizeText(item.customer_name || 'Atendimento')}</strong>
                            <span>${sanitizeText(item.service?.name || 'Agenda')} · ${sanitizeText(item.professional?.display_name || '—')}</span>
                        </div>
                        <span class="ops-status ops-status-${sanitizeText((item.state || 'BOOKED').toLowerCase())}">
                            ${sanitizeText(stateLabels[item.state] || item.state || 'Agendado')}
                        </span>
                    </div>
                `;
            }).join('')
            : `
                <div class="ops-empty">
                    <strong>Agenda livre hoje</strong>
                    <span>Nenhum atendimento carregado para esta data.</span>
                </div>
            `;

        content.innerHTML = `
            <div class="content-inner ops-dashboard">
                <section class="ops-hero">
                    <div>
                        <span class="ops-eyebrow">OPERAÇÃO / QS 121</span>
                        <h1>BROOKLYN<br><em>CONTROL.</em></h1>
                        <p>Visão diária de agenda, caixa, recebimentos e equipe.</p>
                    </div>

                    <div class="ops-hero-actions">
                        <a href="#agenda" class="ops-action-primary">ABRIR AGENDA <b>↗</b></a>
                        <a href="#financeiro" class="ops-action-link">FINANCEIRO</a>
                    </div>
                </section>

                <section class="ops-kpis">
                    <article>
                        <span>HOJE</span>
                        <strong>${todayAgenda.length}</strong>
                        <small>atendimentos</small>
                    </article>
                    <article>
                        <span>RECEBIDO</span>
                        <strong>R$ ${(receivedCents / 100).toFixed(2)}</strong>
                        <small>líquido</small>
                    </article>
                    <article>
                        <span>A RECEBER</span>
                        <strong>R$ ${(dueCents / 100).toFixed(2)}</strong>
                        <small>saldo aberto</small>
                    </article>
                    <article>
                        <span>COMISSÕES</span>
                        <strong>R$ ${(commissionCents / 100).toFixed(2)}</strong>
                        <small>a repassar</small>
                    </article>
                </section>

                <section class="ops-main-grid">
                    <article class="ops-panel ops-panel-agenda">
                        <div class="ops-panel-head">
                            <div>
                                <span>AGENDA / HOJE</span>
                                <h2>Movimento do dia</h2>
                            </div>
                            <a href="#agenda">VER AGENDA ↗</a>
                        </div>
                        <div class="ops-appointment-list">${agendaCards}</div>
                    </article>

                    <article class="ops-panel ops-cash-card ${openCash ? 'is-open' : 'is-closed'}">
                        <div class="ops-panel-head">
                            <div>
                                <span>CAIXA</span>
                                <h2>${openCash ? 'Sessão aberta' : 'Sessão fechada'}</h2>
                            </div>
                            <span class="ops-cash-dot"></span>
                        </div>

                        <p>
                            ${openCash
                                ? `Esperado agora: R$ ${(Number(openCash.expected_cash_now_cents || 0) / 100).toFixed(2)}`
                                : 'Abra o caixa antes de registrar movimentações em dinheiro.'}
                        </p>

                        <a href="#financeiro" class="ops-action-link">IR PARA O CAIXA ↗</a>
                    </article>
                </section>

                <section class="ops-secondary-grid">
                    <article class="ops-panel">
                        <div class="ops-panel-head">
                            <div>
                                <span>ESTRUTURA</span>
                                <h2>Catálogo ativo</h2>
                            </div>
                            <a href="#configuracoes">CONFIGURAR ↗</a>
                        </div>

                        <div class="ops-catalog-stats">
                            <div><strong>${services.length}</strong><span>serviços</span></div>
                            <div><strong>${professionals.length}</strong><span>profissionais</span></div>
                            <div><strong>${Number(ws.customers_count || 0)}</strong><span>clientes</span></div>
                        </div>
                    </article>
                </section>
            </div>
        `;
    } catch (error) {
        console.error('Owner dashboard error:', error);
        content.innerHTML = `
            <div class="content-inner">
                <div class="alert alert-error">
                    Erro ao carregar visão geral: ${sanitizeText(error.message || 'erro desconhecido')}
                </div>
            </div>
        `;
    }
}

async function renderBookingPage() {
    const content = document.getElementById('content');
    updateTopbar('Agendamento', 'Reserve seu horário');

    content.innerHTML = `
        <div class="content-inner">
            <div id="booking-container">
                <div style="text-align:center;padding:2rem;">
                    <div class="loading" style="display:inline-block;"></div>
                    Carregando...
                </div>
            </div>
        </div>
    `;

    try {
        const explicitDemo = isExplicitBookingDemo();
        const lastBooking = localStorage.getItem('last_appointment');

        if (lastBooking) {
            try {
                const booking = JSON.parse(lastBooking);

                const canManageStoredBooking =
                    booking?.tenant === 'live' ||
                    (explicitDemo && booking?.tenant === 'demo');

                if (canManageStoredBooking) {
                    await renderBookingManagement(booking);
                    return;
                }
            } catch (error) {
                console.warn('Stored booking ignored:', error);
            }
        }

        await checkBookingMode();

        const container = content.querySelector('#booking-container');

        if (appState.bookingState.mode === 'unavailable') {
            container.innerHTML = `
                <section class="booking-unavailable-card">
                    <span>AGENDAMENTO ONLINE</span>

                    <h2>
                        INDISPONÍVEL<br>
                        <em>NO MOMENTO.</em>
                    </h2>

                    <p>
                        O canal público ainda não foi liberado pela unidade.
                        Nenhuma reserva de demonstração será criada para clientes reais.
                    </p>

                    <a href="#home" class="editorial-cta">
                        <span>VOLTAR AO INÍCIO</span>
                        <b>↗</b>
                    </a>
                </section>
            `;
            return;
        }

        const bookingHTML = getBookingHTML();

        container.innerHTML =
            appState.bookingState.mode === 'demo'
                ? `
                    <div class="demo-banner">
                        MODO APRESENTAÇÃO — reservas e dados deste ambiente
                        não pertencem à operação real
                    </div>
                    ${bookingHTML}
                `
                : bookingHTML;

        await loadBookingCatalog();
        setupBookingListeners();
    } catch (error) {
        console.error('Booking page error:', error);

        const container = content.querySelector('#booking-container');

        if (container) {
            container.innerHTML = `
                <div class="alert alert-error">
                    Erro ao carregar agendamento
                </div>
            `;
        }
    }
}

async function renderBookingManagement(booking) {
    const content = document.getElementById('content');

    content.innerHTML = `
        <div class="content-inner">
            <div id="booking-management-container">
                <div style="text-align: center; padding: 2rem;">
                    <div class="loading" style="display: inline-block;"></div> Carregando detalhes da reserva...
                </div>
            </div>
        </div>
    `;

    try {
        const response = await fetch(
            `${BOOKING_ENDPOINT}?mode=manage&tenant=${booking.tenant}&appointment_id=${booking.appointment_id}&token=${booking.management_token}`
        );

        if (!response.ok) throw new Error('Failed to load booking details');
        
        const data = await response.json();
        const appt = data.appointment;
        const policy = data.policy;

        const startsAt = new Date(appt.starts_at).toLocaleString('pt-BR', {
            timeZone: 'America/Sao_Paulo'
        });

        let html = `
            <div class="card">
                <div class="card-title">Detalhes da reserva</div>
                <table style="width: 100%; border-collapse: collapse;">
                    <tr style="border-bottom: 1px solid #f0f0f0;">
                        <td style="padding: 0.75rem 0;">Cliente:</td>
                        <td style="padding: 0.75rem 0;"><strong>${sanitizeText(appt.customer_name || '—')}</strong></td>
                    </tr>
                    <tr style="border-bottom: 1px solid #f0f0f0;">
                        <td style="padding: 0.75rem 0;">Serviço:</td>
                        <td style="padding: 0.75rem 0;"><strong>${sanitizeText(appt.service?.name || '—')}</strong></td>
                    </tr>
                    <tr style="border-bottom: 1px solid #f0f0f0;">
                        <td style="padding: 0.75rem 0;">Profissional:</td>
                        <td style="padding: 0.75rem 0;"><strong>${sanitizeText(appt.professional?.display_name || '—')}</strong></td>
                    </tr>
                    <tr style="border-bottom: 1px solid #f0f0f0;">
                        <td style="padding: 0.75rem 0;">Data/Hora:</td>
                        <td style="padding: 0.75rem 0;"><strong>${startsAt}</strong></td>
                    </tr>
                    <tr>
                        <td style="padding: 0.75rem 0;">Estado:</td>
                        <td style="padding: 0.75rem 0;"><span class="badge badge-info">${sanitizeText(appt.state || '—')}</span></td>
                    </tr>
                </table>

                <div class="button-group" style="margin-top: 1.5rem;">
                    ${policy?.allow_public_cancel ? `
                        <button class="button button-danger" data-kira-action="cancelPublicBooking('${booking.appointment_id}', '${booking.management_token}', '${booking.tenant}')">
                            Cancelar
                        </button>
                    ` : ''}
                    ${policy?.allow_public_reschedule ? `
                        <button class="button button-secondary" data-kira-action="showRescheduleForm('${booking.appointment_id}', '${booking.management_token}', '${booking.tenant}', '${appt.service.id}', '${appt.professional.id}')">
                            Reagendar
                        </button>
                    ` : ''}
                    <button class="button button-secondary" data-kira-action="navigateTo('home')">Voltar</button>
                    <button class="button button-secondary" data-kira-action="forgetBookingThisDevice()" style="opacity: 0.7;">Esquecer neste dispositivo</button>
                </div>
            </div>
        `;

        content.querySelector('#booking-management-container').innerHTML = html;
    } catch (error) {
        console.error('Booking management error:', error);
        content.querySelector('#booking-management-container').innerHTML = `
            <div class="alert alert-error">Erro ao carregar detalhes da reserva</div>
            <button class="button button-secondary" data-kira-action="navigateTo('home')" style="margin-top: 1rem;">Voltar</button>
        `;
    }
}

async function cancelPublicBooking(appointmentId, token, tenant) {
    try {
        if (!confirm('Tem certeza que deseja cancelar esta reserva?')) return;

        const response = await fetch(`${BOOKING_ENDPOINT}?tenant=${tenant}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'cancel',
                appointment_id: appointmentId,
                token: token
            })
        });

        if (!response.ok) throw new Error('Cancel failed');
        
        // Remove token after successful cancel
        localStorage.removeItem('last_appointment');
        showAlert('Reserva cancelada com sucesso', 'success');
        setTimeout(() => navigateTo('home'), 2000);
    } catch (error) {
        console.error('Cancel error:', error);
        showAlert('Erro ao cancelar reserva', 'error');
    }
}

function forgetBookingThisDevice() {
    if (!confirm('Isto removerá o acesso a esta reserva neste dispositivo. Continuar?')) return;
    
    localStorage.removeItem('last_appointment');
    showAlert('Reserva esquecida neste dispositivo', 'success');
    setTimeout(() => navigateTo('home'), 1500);
}

function showRescheduleForm(appointmentId, token, tenant, serviceId, professionalId) {
    const content = document.getElementById('content');
    
    content.innerHTML = `
        <div class="content-inner">
            <div class="card" style="max-width: 500px;">
                <div class="card-title">Reagendar reserva</div>
                
                <div class="form-group">
                    <label>Nova data</label>
                    <input type="date" id="reschedule-date" min="${getTodayDate()}">
                </div>

                <div class="form-group" id="reschedule-time-container" style="display:none;">
                    <label>Novo horário</label>
                    <select id="reschedule-time">
                        <option value="">Selecione um horário</option>
                    </select>
                </div>

                <div class="button-group" style="margin-top: 1.5rem;">
                    <button class="button button-primary" data-kira-action="submitReschedule('${appointmentId}', '${token}', '${tenant}')">
                        Confirmar reagendamento
                    </button>
                    <button class="button button-secondary" data-kira-action="navigateTo('agendamento')">
                        Voltar
                    </button>
                </div>
            </div>
        </div>
    `;

    document.getElementById('reschedule-date').addEventListener('change', async () => {
        const date = document.getElementById('reschedule-date').value;
        if (!date) return;

        try {
            const availResponse = await fetch(
                `${BOOKING_ENDPOINT}?mode=availability&tenant=${tenant}&service_id=${serviceId}&professional_id=${professionalId}&date=${date}`
            );
            
            if (!availResponse.ok) throw new Error('Availability check failed');
            const availData = await availResponse.json();

            const timeSelect = document.getElementById('reschedule-time');
            timeSelect.innerHTML = '<option value="">Selecione um horário</option>';
            
            if (availData.slots && availData.slots.length > 0) {
                document.getElementById('reschedule-time-container').style.display = 'block';
                availData.slots.forEach(slot => {
                    const option = document.createElement('option');
                    option.value = slot.starts_at;
                    option.textContent = slot.label;
                    timeSelect.appendChild(option);
                });
            } else {
                document.getElementById('reschedule-time-container').style.display = 'none';
                showAlert('Sem horários disponíveis para esta data', 'warning');
            }
        } catch (error) {
            console.error('Availability load error:', error);
            showAlert('Erro ao carregar horários disponíveis', 'error');
        }
    });
}

async function submitReschedule(appointmentId, token, tenant) {
    try {
        const newStartsAt = document.getElementById('reschedule-time').value;

        if (!newStartsAt) {
            showAlert('Selecione um horário', 'error');
            return;
        }

        const response = await fetch(`${BOOKING_ENDPOINT}?tenant=${tenant}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'reschedule',
                appointment_id: appointmentId,
                token: token,
                new_starts_at: newStartsAt
            })
        });

        if (!response.ok) throw new Error('Reschedule failed');
        
        showAlert('Reserva reagendada com sucesso', 'success');
        setTimeout(() => navigateTo('agendamento'), 2000);
    } catch (error) {
        console.error('Reschedule error:', error);
        showAlert('Erro ao reagendar reserva', 'error');
    }
}

async function checkBookingMode() {
    if (isExplicitBookingDemo()) {
        appState.bookingState.mode = 'demo';
        appState.bookingState.tenant = 'demo';
        return;
    }

    try {
        const response = await fetch(
            `${BOOKING_ENDPOINT}?mode=catalog&tenant=live`
        );

        if (!response.ok) {
            throw new Error('Live mode unavailable');
        }

        const data = await response.json();

        if (
            data.booking_enabled === true &&
            data.services?.length > 0 &&
            data.professionals?.length > 0
        ) {
            appState.bookingState.mode = 'live';
            appState.bookingState.tenant = 'live';
            return;
        }

        appState.bookingState.mode = 'unavailable';
        appState.bookingState.tenant = 'live';
    } catch (error) {
        console.error('Booking mode check error:', error);
        appState.bookingState.mode = 'unavailable';
        appState.bookingState.tenant = 'live';
    }
}

async function loadBookingCatalog() {
    try {
        const tenant = appState.bookingState.tenant;
        const response = await fetch(`${BOOKING_ENDPOINT}?mode=catalog&tenant=${tenant}`);
        if (!response.ok) throw new Error('Catalog load failed');
        
        const data = await response.json();
        appState.services = data.services || [];
        appState.professionals = data.professionals || [];
        
        // Populate services
        const serviceSelect = document.getElementById('service-select');
        if (serviceSelect && appState.services) {
            serviceSelect.innerHTML = '<option value="">Selecione um serviço</option>';
            appState.services.forEach(service => {
                const option = document.createElement('option');
                option.value = service.id;
                option.textContent = `${service.name} — R$ ${(service.price_cents / 100).toFixed(2)}`;
                serviceSelect.appendChild(option);
            });
        }
    } catch (error) {
        console.error('Catalog load error:', error);
    }
}

function getBookingHTML() {
    return `
        <div class="booking-editorial-layout">
            <aside class="booking-editorial-intro">
                <span class="hero-eyebrow">RESERVA / QS 121</span>
                <h2>MARQUE<br>SEU<br><em>HORÁRIO.</em></h2>
                <p>Selecione serviço, profissional, data e um horário disponível.</p>

                <div class="booking-aside-meta">
                    <span>BARBEARIA BROOKLYN</span>
                    <strong>SAMAMBAIA · BRASÍLIA/DF</strong>
                </div>
            </aside>

            <div class="booking-editorial-card">
                <div class="booking-card-head">
                    <div>
                        <span>AGENDAMENTO</span>
                        <h3>Escolha seu atendimento</h3>
                    </div>
                    <a href="#home" class="booking-back">← VOLTAR</a>
                </div>

                <div class="booking-form-grid">
                    <div class="form-group">
                        <label>01 / Serviço</label>
                        <select id="service-select"><option value="">Carregando...</option></select>
                    </div>

                    <div class="form-group">
                        <label>02 / Profissional</label>
                        <select id="professional-select">
                            <option value="">Selecione um serviço primeiro</option>
                        </select>
                    </div>

                    <div class="form-group">
                        <label>03 / Data</label>
                        <input type="date" id="booking-date" min="${getTodayDate()}">
                    </div>

                    <div class="form-group" id="time-container" style="display:none;">
                        <label>04 / Horário</label>
                        <select id="time-select"><option value="">Selecione um horário</option></select>
                    </div>
                </div>

                <div class="booking-customer-block" id="customer-form" style="display:none;">
                    <div class="booking-divider"><span>DADOS DO CLIENTE</span></div>

                    <div class="booking-form-grid">
                        <div class="form-group">
                            <label>Nome completo</label>
                            <input type="text" id="customer-name" placeholder="Seu nome">
                        </div>
                        <div class="form-group">
                            <label>Telefone</label>
                            <input type="tel" id="customer-phone" placeholder="(61) 99999-9999">
                        </div>
                    </div>

                    <div class="button-group booking-actions">
                        <button class="editorial-cta editorial-button" id="confirm-booking">
                            <span>CONFIRMAR AGENDAMENTO</span><b>↗</b>
                        </button>
                        <button class="button button-secondary" id="cancel-booking">Cancelar</button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function setupBookingListeners() {
    const dateInput = document.getElementById('booking-date');
    const serviceSelect = document.getElementById('service-select');
    const professionalSelect = document.getElementById('professional-select');
    const confirmBtn = document.getElementById('confirm-booking');
    const cancelBtn = document.getElementById('cancel-booking');

    serviceSelect?.addEventListener('change', handleServiceChange);
    professionalSelect?.addEventListener('change', handleProfessionalChange);
    dateInput?.addEventListener('change', loadAvailableTimes);
    confirmBtn?.addEventListener('click', submitBooking);
    cancelBtn?.addEventListener('click', () => navigateTo('home'));
}

function handleServiceChange() {
    const serviceId = document.getElementById('service-select').value;
    const professionalSelect = document.getElementById('professional-select');
    
    if (serviceId) {
        const filteredProfessionals = appState.professionals.filter(prof => 
            prof.service_ids && prof.service_ids.includes(serviceId)
        );
        
        professionalSelect.innerHTML = '<option value="">Selecione um profissional</option>';
        filteredProfessionals.forEach(prof => {
            const option = document.createElement('option');
            option.value = prof.id;
            option.textContent = prof.display_name;
            professionalSelect.appendChild(option);
        });
        
        document.getElementById('time-container').style.display = 'none';
        document.getElementById('customer-form').style.display = 'none';
    } else {
        professionalSelect.innerHTML = '<option value="">Selecione um serviço primeiro</option>';
        document.getElementById('time-container').style.display = 'none';
        document.getElementById('customer-form').style.display = 'none';
    }
}

function handleProfessionalChange() {
    const service = document.getElementById('service-select').value;
    const professional = document.getElementById('professional-select').value;
    
    if (service && professional) {
        document.getElementById('time-container').style.display = 'block';
        document.getElementById('customer-form').style.display = 'block';
    } else {
        document.getElementById('time-container').style.display = 'none';
        document.getElementById('customer-form').style.display = 'none';
    }
}

async function loadAvailableTimes() {
    try {
        const service = document.getElementById('service-select').value;
        const professional = document.getElementById('professional-select').value;
        const date = document.getElementById('booking-date').value;

        if (!service || !professional || !date) return;

        const response = await fetch(
            `${BOOKING_ENDPOINT}?mode=availability&tenant=${appState.bookingState.tenant}&service_id=${service}&professional_id=${professional}&date=${date}`
        );

        if (!response.ok) throw new Error('Availability check failed');
        const data = await response.json();

        const timeSelect = document.getElementById('time-select');
        timeSelect.innerHTML = '<option value="">Selecione um horário</option>';
        
        if (data.slots && data.slots.length > 0) {
            data.slots.forEach(slot => {
                const option = document.createElement('option');
                option.value = slot.starts_at;
                option.textContent = slot.label;
                timeSelect.appendChild(option);
            });
        } else {
            timeSelect.innerHTML = '<option value="">Sem horários disponíveis</option>';
        }
    } catch (error) {
        console.error('Time load error:', error);
    }
}

async function submitBooking() {
    if (publicBookingMutationState.pending) return;

    const confirmButton = document.getElementById('confirm-booking');

    try {
        const service =
            document.getElementById('service-select').value;

        const professional =
            document.getElementById('professional-select').value;

        const startsAt =
            document.getElementById('time-select').value;

        const name =
            document.getElementById('customer-name').value.trim();

        const phone =
            document.getElementById('customer-phone').value.trim();

        if (!service || !professional || !startsAt || !name || !phone) {
            showAlert('Preencha todos os campos', 'error');
            return;
        }

        const payloadSignature = JSON.stringify({
            service,
            professional,
            startsAt,
            name,
            phone,
            tenant: appState.bookingState.tenant
        });

        if (
            !publicBookingMutationState.idempotencyKey ||
            publicBookingMutationState.payloadSignature !== payloadSignature
        ) {
            publicBookingMutationState.idempotencyKey = crypto.randomUUID();
            publicBookingMutationState.payloadSignature = payloadSignature;
        }

        publicBookingMutationState.pending = true;

        if (confirmButton) {
            confirmButton.disabled = true;
            confirmButton.setAttribute('aria-busy', 'true');
        }

        const response = await fetch(
            `${BOOKING_ENDPOINT}?tenant=${appState.bookingState.tenant}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    service_id: service,
                    professional_id: professional,
                    starts_at: startsAt,
                    customer_name: name,
                    customer_phone: phone,
                    idempotency_key:
                        publicBookingMutationState.idempotencyKey
                })
            }
        );

        const result = await response.json().catch(() => ({}));

        if (!response.ok) {
            const code = result?.error || 'BOOKING_FAILED';

            if (code === 'TIME_CONFLICT') {
                throw new Error(
                    'Esse horário acabou de ficar indisponível. Escolha outro horário.'
                );
            }

            if (code === 'LIVE_BOOKING_DISABLED') {
                throw new Error(
                    'O agendamento online foi desativado pela unidade.'
                );
            }

            if (code === 'RATE_LIMITED') {
                throw new Error(
                    'Muitas tentativas em sequência. Aguarde um momento e tente novamente.'
                );
            }

            throw new Error('Não foi possível confirmar o agendamento.');
        }

        localStorage.setItem(
            'last_appointment',
            JSON.stringify({
                appointment_id: result.appointment,
                management_token: result.management_token,
                tenant: appState.bookingState.tenant
            })
        );

        publicBookingMutationState.idempotencyKey = null;
        publicBookingMutationState.payloadSignature = null;

        showAlert(
            appState.bookingState.mode === 'demo'
                ? 'Reserva de demonstração criada com sucesso.'
                : 'Agendamento confirmado com sucesso.',
            'success'
        );

        setTimeout(() => navigateTo('home'), 1600);
    } catch (error) {
        console.error('Booking submit error:', error);

        showAlert(
            error?.message || 'Erro ao confirmar agendamento',
            'error'
        );
    } finally {
        publicBookingMutationState.pending = false;

        if (confirmButton && document.body.contains(confirmButton)) {
            confirmButton.disabled = false;
            confirmButton.removeAttribute('aria-busy');
        }
    }
}

function renderLocationPage() {
    const content = document.getElementById('content');
    updateTopbar('Localização', 'Barbearia Brooklyn · QS 121');

    content.innerHTML = `
        <div class="content-inner brooklyn-location-v6-shell">
            <section class="location-v6">
                <div class="location-v6-copy">
                    <span class="story-kicker">BROOKLYN / 121 / SAMAMBAIA</span>
                    <h1>CHEGUE<br><em>CERTO.</em></h1>

                    <p>
                        Barbearia Brooklyn — Unidade QS 121, Samambaia, Brasília — DF.
                        Abra a rota direto no Google Maps e chegue à unidade com facilidade.
                    </p>

                    <div class="location-v6-meta">
                        <article>
                            <span>UNIDADE</span>
                            <strong>QS 121</strong>
                        </article>
                        <article>
                            <span>CIDADE</span>
                            <strong>Brasília · DF</strong>
                        </article>
                        <article>
                            <span>REGIÃO</span>
                            <strong>Samambaia</strong>
                        </article>
                    </div>

                    <div class="hero-cta-row">
                        <a href="${MAPS_URL}" target="_blank" rel="noopener noreferrer" class="editorial-cta">
                            <span>ABRIR NO MAPS</span>
                            <b>↗</b>
                        </a>

                        <a href="#agendamento" class="editorial-ghost-link">MARCAR HORÁRIO</a>
                    </div>
                </div>

                <div class="location-v6-map">
                    <div class="location-v6-map-head">
                        <span>GOOGLE MAPS</span>
                        <strong>BARBEARIA BROOKLYN</strong>
                    </div>

                    <iframe
                        title="Mapa da Barbearia Brooklyn QS 121"
                        src="https://www.google.com/maps?q=Barbearia%20Brooklyn%20QS%20121%20Samambaia%20Brasilia%20DF&output=embed"
                        loading="lazy"
                        referrerpolicy="no-referrer-when-downgrade">
                    </iframe>

                    <div class="location-v6-map-foot">
                        <span>ROTA EXTERNA</span>
                        <a href="${MAPS_URL}" target="_blank" rel="noopener noreferrer">ABRIR GOOGLE MAPS ↗</a>
                    </div>
                </div>
            </section>
        </div>
    `;
}

// ============================================================
// Authentication
// ============================================================

async function renderAuthPage() {
    const content = document.getElementById('content');
    updateTopbar('Acesso interno', 'Área da equipe');

    if (!appState.currentUser) {
        renderLoginForm();
        return;
    }

    if (!appState.userRole) {
        content.innerHTML = `
            <div class="content-inner">
                <div class="card" style="max-width:560px;margin:2rem auto;">
                    <div class="card-title">Sincronizando acesso</div>
                    <p class="text-muted">Sua sessão está ativa. Estamos carregando seu perfil de gestão.</p>
                    <div class="ops-loading">
                        <div class="loading"></div>
                        <span>Verificando permissão...</span>
                    </div>
                </div>
            </div>
        `;

        const ok = await ensureWorkspaceAccess();
        if (!ok) {
            renderAccessRecoveryState();
            return;
        }
    }

    renderLoggedInAuth();
}

function renderAccessRecoveryState() {
    const content = document.getElementById('content');
    updateTopbar('Acesso interno', 'Sincronização de conta');

    content.innerHTML = `
        <div class="content-inner">
            <div class="card" style="max-width:560px;margin:2rem auto;">
                <div class="card-title">Conta autenticada</div>
                <p class="text-muted">
                    Não foi possível carregar a permissão neste momento.
                    Sua conta não precisa de código de ativação.
                </p>
                <div class="button-group" style="margin-top:1rem;">
                    <button class="button button-primary" id="retry-access-btn">Tentar novamente</button>
                    <button class="button button-secondary" id="logout-access-btn">Sair</button>
                </div>
            </div>
        </div>
    `;

    document.getElementById('retry-access-btn').addEventListener('click', async () => {
        const ok = await ensureWorkspaceAccess();
        if (ok) {
            showAlert('Acesso sincronizado', 'success');
            navigateTo('home');
        } else {
            showAlert('Ainda não foi possível sincronizar o acesso.', 'error');
        }
    });

    document.getElementById('logout-access-btn').addEventListener('click', handleLogout);
}

// KIRA_ACCESS_HARDENING_V21
function renderLoginForm() {
    const content = document.getElementById('content');

    content.innerHTML = `
        <div class="content-inner">
            <div class="card internal-login-card">
                <div class="internal-login-head">
                    <span>ACESSO INTERNO</span>
                    <div class="card-title">Kira-CEO Brooklyn</div>
                    <p>Área restrita a contas autorizadas pela unidade.</p>
                </div>

                <div class="form-group">
                    <label>E-mail</label>
                    <input
                        type="email"
                        id="login-email"
                        autocomplete="username"
                        placeholder="seu@email.com"
                    >
                </div>

                <div class="form-group">
                    <label>Senha</label>
                    <input
                        type="password"
                        id="login-password"
                        autocomplete="current-password"
                        placeholder="••••••••"
                    >
                </div>

                <button
                    class="button button-primary"
                    id="login-btn"
                    style="width:100%;"
                >
                    Entrar
                </button>

                <div class="internal-login-actions">
                    <button
                        class="button button-secondary"
                        id="forgot-password-btn"
                        style="width:100%;"
                    >
                        Esqueci minha senha
                    </button>
                </div>

                <div class="internal-login-note">
                    <strong>Conta nova?</strong>
                    <span>
                        O acesso é criado e autorizado pela administração.
                        Não existe cadastro público para a área interna.
                    </span>
                </div>

                <div id="auth-message" style="margin-top:1rem;"></div>
            </div>
        </div>
    `;

    document
        .getElementById('login-btn')
        .addEventListener('click', handleLogin);

    document
        .getElementById('forgot-password-btn')
        .addEventListener('click', () => showPasswordResetRequestForm());
}

function showPasswordResetRequestForm() {
    const content = document.getElementById('content');
    content.innerHTML = `
        <div class="content-inner">
            <div class="card" style="max-width: 400px; margin: 2rem auto;">
                <div class="card-title" style="text-align: center; margin-bottom: 1.5rem;">Redefinir senha</div>
                <p style="color:#666; margin-bottom:1rem;">Informe o e-mail da sua conta. Enviaremos um link seguro para criar uma nova senha.</p>
                <div class="form-group">
                    <label>E-mail</label>
                    <input type="email" id="reset-email" placeholder="seu@email.com">
                </div>
                <button class="button button-primary" id="send-reset-btn" style="width:100%;">Enviar link de recuperação</button>
                <div style="text-align:center; margin-top:0.75rem;">
                    <button class="button button-secondary" id="reset-back-btn" style="width:100%;">Voltar ao login</button>
                </div>
                <div id="auth-message" style="margin-top:1rem;"></div>
            </div>
        </div>
    `;

    document.getElementById('send-reset-btn').addEventListener('click', handlePasswordResetRequest);
    document.getElementById('reset-back-btn').addEventListener('click', () => renderLoginForm());
}

async function handlePasswordResetRequest() {
    try {
        const email = document.getElementById('reset-email').value.trim();
        if (!email) {
            showMessage('Digite seu e-mail', 'error');
            return;
        }

        const { error } = await appState.supabaseClient.auth.resetPasswordForEmail(email, {
            redirectTo: APP_BASE_URL
        });

        if (error) throw error;
        showMessage('Link de recuperação enviado. Confira seu e-mail.', 'success');
    } catch (error) {
        console.error('Password reset request error:', error);
        showMessage('Erro ao enviar recuperação: ' + error.message, 'error');
    }
}

function renderPasswordUpdateForm() {
    const content = document.getElementById('content');
    updateTopbar('Nova senha', 'Recuperação de acesso');

    if (!appState.currentSession) {
        content.innerHTML = `
            <div class="content-inner">
                <div class="card" style="max-width:400px; margin:2rem auto;">
                    <div class="card-title">Link de recuperação inválido ou expirado</div>
                    <p style="color:#666; margin-bottom:1rem;">Solicite um novo link de recuperação.</p>
                    <button class="button button-primary" data-kira-action="showPasswordResetRequestForm()" style="width:100%;">Solicitar novo link</button>
                </div>
            </div>
        `;
        return;
    }

    content.innerHTML = `
        <div class="content-inner">
            <div class="card" style="max-width:400px; margin:2rem auto;">
                <div class="card-title" style="text-align:center; margin-bottom:1.5rem;">Criar nova senha</div>
                <div class="form-group">
                    <label>Nova senha</label>
                    <input type="password" id="new-password" placeholder="••••••••">
                </div>
                <div class="form-group">
                    <label>Confirmar nova senha</label>
                    <input type="password" id="new-password-confirm" placeholder="••••••••">
                </div>
                <button class="button button-primary" id="update-password-btn" style="width:100%;">Salvar nova senha</button>
                <div id="auth-message" style="margin-top:1rem;"></div>
            </div>
        </div>
    `;

    document.getElementById('update-password-btn').addEventListener('click', handlePasswordUpdate);
}

async function handlePasswordUpdate() {
    try {
        const password = document.getElementById('new-password').value;
        const confirm = document.getElementById('new-password-confirm').value;

        if (!password || !confirm) {
            showMessage('Preencha os dois campos', 'error');
            return;
        }
        if (password !== confirm) {
            showMessage('As senhas não correspondem', 'error');
            return;
        }
        if (password.length < 12) {
            showMessage('Use uma senha com pelo menos 12 caracteres', 'error');
            return;
        }

        const { error } = await appState.supabaseClient.auth.updateUser({ password });
        if (error) throw error;

        appState.passwordRecoveryMode = false;
        await appState.supabaseClient.auth.signOut();
        appState.currentSession = null;
        appState.currentUser = null;
        appState.workspaceData = null;
        appState.userRole = null;
        updateUserInfo();
        updateNavigationByRole();
        showAlert('Senha alterada. Entre novamente com a nova senha.', 'success');
        setTimeout(() => navigateTo('acesso-interno'), 800);
    } catch (error) {
        console.error('Password update error:', error);
        showMessage('Erro ao atualizar senha: ' + error.message, 'error');
    }
}

// KIRA_DIRECT_LOGIN_V24_2
let loginRequestPending = false;

async function handleLogin() {
    if (loginRequestPending) return;
    const button = document.getElementById('login-btn');

    try {
        const email = document.getElementById('login-email').value.trim();
        const password = document.getElementById('login-password').value;

        if (!email || !password) {
            showMessage('Preencha e-mail e senha', 'error');
            return;
        }

        loginRequestPending = true;
        if (button) {
            button.disabled = true;
            button.textContent = 'Entrando...';
        }

        const { data, error } = await appState.supabaseClient.auth.signInWithPassword({ email, password });
        if (error) throw error;

        appState.currentSession = data.session;
        appState.currentUser = data.user;

        const ok = await ensureWorkspaceAccess();
        updateUserInfo();
        updateNavigationByRole();

        if (!ok) {
            renderAccessRecoveryState();
            return;
        }

        navigateTo('home');
    } catch (error) {
        console.error('Login error:', error);
        showMessage('Erro ao fazer login: ' + error.message, 'error');
    } finally {
        loginRequestPending = false;
        if (button && document.body.contains(button)) {
            button.disabled = false;
            button.textContent = 'Entrar';
        }
    }
}

function renderInitialOwnerActivation() {
    // O proprietário já possui membership OWNER.
    // Fluxo de token antigo desativado para evitar pedir código novamente.
    renderAccessRecoveryState();
}

// BROOKLYN_OWNER_ACCESS_CLEANUP_V8
// Fluxo legado de ativação removido.
// O proprietário já possui membership OWNER persistente no banco.

// KIRA_ACCOUNT_ACCESS_V24_4
function renderLoggedInAuth() {
    if (!appState.currentUser || !appState.currentSession) {
        renderLoginForm();
        return;
    }

    if (appState.passwordRecoveryMode) {
        navigateTo('redefinir-senha');
        return;
    }

    if (!appState.userRole) {
        renderAccessRecoveryState();
        return;
    }

    if (appState.currentPage !== 'acesso-interno') return;

    const content = document.getElementById('content');
    const roleLabels = {
        OWNER: 'Proprietário',
        RECEPTION: 'Recepção',
        BARBER: 'Profissional'
    };

    updateTopbar('Minha conta', 'Sessão ativa');
    content.innerHTML = `
        <div class="content-inner">
            <div class="card internal-login-card">
                <div class="internal-login-head">
                    <span>MINHA CONTA</span>
                    <div class="card-title">Você está conectado</div>
                    <p>${sanitizeText(appState.currentUser.email || '')}</p>
                </div>
                <p>Perfil: <strong>${sanitizeText(roleLabels[appState.userRole] || 'Equipe')}</strong></p>
                <div class="button-group" style="margin-top:1rem;">
                    <button class="button button-primary" id="dashboard-btn">Abrir gestão</button>
                    <button class="button button-secondary" id="logout-btn">Sair</button>
                </div>
            </div>
        </div>
    `;

    document.getElementById('dashboard-btn')
        .addEventListener('click', () => navigateTo('home'));
    document.getElementById('logout-btn')
        .addEventListener('click', handleLogout);
}

async function handleLogout() {
    try {
        await appState.supabaseClient.auth.signOut();
        appState.currentUser = null;
        appState.currentSession = null;
        appState.workspaceData = null;
        appState.userRole = null;
        updateNavigationByRole();
        updateUserInfo();
        showAlert('Até logo!', 'success');
        setTimeout(() => navigateTo('home'), 500);
    } catch (error) {
        console.error('Logout error:', error);
        showAlert('Erro ao fazer logout', 'error');
    }
}

// ============================================================
// Protected Pages (Schedule, Financial, Reports, Configuration)
// ============================================================

async function renderSchedulePage() {
    const content = document.getElementById('content');
    updateTopbar('Agenda', 'Operação diária');

    content.innerHTML = `
        <div class="content-inner">
            <div class="ops-loading"><div class="loading"></div><span>Carregando agenda...</span></div>
        </div>
    `;

    try {
        if (!appState.workspaceData) {
            await loadWorkspaceData();
        }

        const agenda = [...(appState.workspaceData?.agenda || [])]
            .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));

        const states = {
            BOOKED: 'Agendado',
            CONFIRMED: 'Confirmado',
            IN_SERVICE: 'Em atendimento',
            COMPLETED: 'Concluído',
            NO_SHOW: 'Faltou',
            CANCELLED: 'Cancelado',
            BLOCKED: 'Bloqueio'
        };

        const activeCount = agenda.filter(a => ['BOOKED', 'CONFIRMED', 'IN_SERVICE'].includes(a.state)).length;
        const completedCount = agenda.filter(a => a.state === 'COMPLETED').length;
        const noShowCount = agenda.filter(a => a.state === 'NO_SHOW').length;

        const items = agenda.length ? agenda.map(appt => {
            const start = new Date(appt.starts_at);
            const date = start.toLocaleDateString('pt-BR', {
                weekday: 'short',
                day: '2-digit',
                month: '2-digit',
                timeZone: 'America/Sao_Paulo'
            }).replace('.', '');
            const time = start.toLocaleTimeString('pt-BR', {
                hour: '2-digit',
                minute: '2-digit',
                timeZone: 'America/Sao_Paulo'
            });

            let actions = '';
            if (appt.appointment_id && ['BOOKED', 'CONFIRMED'].includes(appt.state)) {
                actions = `
                    <button class="button button-primary compact-action"
                        data-kira-action="updateAppointmentStatus('${appt.appointment_id}', 'IN_SERVICE', this)">Iniciar</button>
                    <button class="button button-secondary compact-action"
                        data-kira-action="updateAppointmentStatus('${appt.appointment_id}', 'NO_SHOW', this)">Faltou</button>
                `;
            } else if (appt.appointment_id && appt.state === 'IN_SERVICE') {
                actions = `
                    <button class="button button-primary compact-action"
                        data-kira-action="updateAppointmentStatus('${appt.appointment_id}', 'COMPLETED', this)">Concluir</button>
                `;
            }

            return `
                <article class="agenda-ticket">
                    <div class="agenda-time-block">
                        <strong>${time}</strong>
                        <span>${sanitizeText(date)}</span>
                    </div>
                    <div class="agenda-ticket-main">
                        <div class="agenda-ticket-top">
                            <div>
                                <span class="agenda-label">CLIENTE</span>
                                <h3>${sanitizeText(appt.customer_name || 'Bloqueio')}</h3>
                            </div>
                            <span class="ops-status ops-status-${sanitizeText((appt.state || 'BOOKED').toLowerCase())}">
                                ${sanitizeText(states[appt.state] || appt.state || 'Agendado')}
                            </span>
                        </div>
                        <div class="agenda-meta-grid">
                            <div><span>Serviço</span><strong>${sanitizeText(appt.service?.name || '—')}</strong></div>
                            <div><span>Profissional</span><strong>${sanitizeText(appt.professional?.display_name || '—')}</strong></div>
                        </div>
                        ${actions ? `<div class="agenda-actions">${actions}</div>` : ''}
                    </div>
                </article>
            `;
        }).join('') : `
            <div class="ops-empty">
                <strong>Nenhum atendimento carregado</strong>
                <span>A agenda aparecerá aqui quando houver reservas ou bloqueios.</span>
            </div>
        `;

        content.innerHTML = `
            <div class="content-inner schedule-pro">
                <section class="module-heading">
                    <div>
                        <span>AGENDA / OPERAÇÃO</span>
                        <h1>ATENDIMENTOS</h1>
                        <p>Controle de status e execução da rotina da unidade.</p>
                    </div>
                </section>

                <section class="schedule-kpis">
                    <div><span>ATIVOS</span><strong>${activeCount}</strong></div>
                    <div><span>CONCLUÍDOS</span><strong>${completedCount}</strong></div>
                    <div><span>FALTAS</span><strong>${noShowCount}</strong></div>
                    <div><span>TOTAL</span><strong>${agenda.length}</strong></div>
                </section>

                <section class="agenda-ticket-list">${items}</section>
            </div>
        `;
    } catch (error) {
        console.error('Schedule page error:', error);
        content.innerHTML = `
            <div class="content-inner">
                <div class="alert alert-error">Erro ao carregar agenda: ${sanitizeText(error.message || 'erro desconhecido')}</div>
            </div>
        `;
    }
}

// KIRA_AGENDA_STABILITY_V14
const appointmentStatusRequests = new Set();

async function updateAppointmentStatus(appointmentId, newState, triggerButton = null) {
    if (!appointmentId || !newState) return;

    if (appointmentStatusRequests.has(appointmentId)) {
        return;
    }

    if (!appState.currentSession?.access_token) {
        showAlert('Sua sessão não está ativa. Entre novamente.', 'error');
        navigateTo('acesso-interno');
        return;
    }

    const ticket = triggerButton?.closest('.agenda-ticket') || null;
    const actionButtons = ticket
        ? Array.from(ticket.querySelectorAll('.agenda-actions .button'))
        : [];

    const stateLabels = {
        IN_SERVICE: 'Atendimento iniciado',
        NO_SHOW: 'Falta registrada',
        COMPLETED: 'Atendimento concluído'
    };

    appointmentStatusRequests.add(appointmentId);

    if (ticket) {
        ticket.classList.add('is-updating');
        ticket.setAttribute('aria-busy', 'true');
    }

    actionButtons.forEach((button) => {
        if (!button.dataset.originalLabel) {
            button.dataset.originalLabel = button.textContent.trim();
        }
        button.disabled = true;
    });

    if (triggerButton) {
        triggerButton.textContent = 'Atualizando...';
    }

    const sendRequest = async () => {
        return fetch(INTERNAL_ENDPOINT, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${appState.currentSession.access_token}`,
                'apikey': appState.supabaseConfig.key,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                action: 'appointment-state',
                appointment_id: appointmentId,
                state: newState
            })
        });
    };

    try {
        let response = await sendRequest();

        if (response.status === 401) {
            const { data, error } = await appState.supabaseClient.auth.refreshSession();

            if (!error && data?.session) {
                appState.currentSession = data.session;
                appState.currentUser = data.session.user;
                response = await sendRequest();
            }
        }

        let payload = null;
        try {
            payload = await response.json();
        } catch {
            payload = null;
        }

        if (!response.ok) {
            if (response.status === 401) {
                throw new Error('Sua sessão expirou. Entre novamente.');
            }

            if (response.status === 403) {
                throw new Error('Você não tem permissão para alterar este atendimento.');
            }

            const backendMessage =
                payload?.detail ||
                payload?.error ||
                `Erro HTTP ${response.status}`;

            throw new Error(backendMessage);
        }

        appState.workspaceData = null;

        const loaded = await loadWorkspaceData(false);
        if (!loaded || !appState.workspaceData) {
            throw new Error('Status salvo, mas não foi possível atualizar a agenda.');
        }

        showAlert(
            stateLabels[newState] || 'Status atualizado com sucesso',
            'success'
        );

        // KIRA_APPOINTMENT_CHECKOUT_V24_3
        if (
            newState === 'COMPLETED' &&
            ['OWNER', 'RECEPTION'].includes(appState.userRole)
        ) {
            navigateTo('financeiro');
        } else {
            await renderSchedulePage();
        }
    } catch (error) {
        console.error('Status update error:', error);

        const message =
            error?.message ||
            'Não foi possível atualizar o status do atendimento.';

        showAlert(message, 'error');

        if (/sessão expirou/i.test(message)) {
            navigateTo('acesso-interno');
        }
    } finally {
        appointmentStatusRequests.delete(appointmentId);

        if (ticket && document.body.contains(ticket)) {
            ticket.classList.remove('is-updating');
            ticket.removeAttribute('aria-busy');
        }

        actionButtons.forEach((button) => {
            if (!document.body.contains(button)) return;

            button.disabled = false;

            if (button.dataset.originalLabel) {
                button.textContent = button.dataset.originalLabel;
            }
        });
    }
}

// KIRA_FINANCE_STABILITY_V15
const financialMutationRequests = new Set();

async function postFinancialAction(body) {
    if (!appState.currentSession?.access_token) {
        throw new Error('Sua sessão não está ativa. Entre novamente.');
    }

    const send = () => fetch(INTERNAL_ENDPOINT, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${appState.currentSession.access_token}`,
            'apikey': appState.supabaseConfig.key,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    let response = await send();

    if (response.status === 401) {
        const { data, error } = await appState.supabaseClient.auth.refreshSession();

        if (!error && data?.session) {
            appState.currentSession = data.session;
            appState.currentUser = data.session.user;
            response = await send();
        }
    }

    let payload = {};
    try {
        payload = await response.json();
    } catch {
        payload = {};
    }

    if (!response.ok) {
        if (response.status === 401) {
            throw new Error('Sua sessão expirou. Entre novamente.');
        }

        if (response.status === 403) {
            throw new Error('Você não tem permissão para executar esta operação.');
        }

        throw new Error(
            payload?.detail ||
            payload?.error ||
            `Erro HTTP ${response.status}`
        );
    }

    return payload;
}

async function refreshFinancialWorkspace() {
    appState.workspaceData = null;
    const loaded = await loadWorkspaceData(false);

    if (!loaded || !appState.workspaceData) {
        throw new Error(
            'Operação confirmada, mas não foi possível atualizar o painel financeiro.'
        );
    }
}

function setFinancialButtonBusy(button, busy, busyLabel = 'Processando...') {
    if (!button) return;

    if (busy) {
        if (!button.dataset.originalLabel) {
            button.dataset.originalLabel = button.textContent.trim();
        }
        button.disabled = true;
        button.textContent = busyLabel;
        button.setAttribute('aria-busy', 'true');
        return;
    }

    button.disabled = false;
    button.removeAttribute('aria-busy');

    if (button.dataset.originalLabel) {
        button.textContent = button.dataset.originalLabel;
    }
}

// KIRA_FINANCE_V2
async function renderFinancialPage() {
    const content = document.getElementById('content');
    updateTopbar('Financeiro', 'Caixa, recebimentos e comissões');

    content.innerHTML = `
        <div class="content-inner">
            <div style="text-align:center;padding:2rem;">
                <div class="loading" style="display:inline-block;"></div> Carregando financeiro...
            </div>
        </div>
    `;

    try {
        const loaded = await loadWorkspaceData();
        if (!loaded || !appState.workspaceData) {
            throw new Error('Não foi possível carregar os dados atualizados do financeiro.');
        }

        const financial = appState.workspaceData.financial || {};
        const agenda = appState.workspaceData?.agenda || [];
        const orders = financial.orders || [];
        const cash = financial.cash || [];
        const commission = await loadVisibleCommissionRows(financial);
        const receipts = financial.receipts || [];
        const refunds = financial.refunds || [];
        const movements = financial.cash_movements || [];
        const payouts = financial.commission_payouts || [];

        const openCashSession = cash.find(session => session.status === 'OPEN') || null;

        const salesCents = orders.reduce((sum, order) => sum + Number(order.total_cents || 0), 0);
        const receivedCents = orders.reduce((sum, order) => sum + Number(order.paid_cents || 0), 0);
        const dueCents = orders.reduce((sum, order) => sum + Number(order.balance_cents || 0), 0);
        const refundedCents = refunds
            .filter(r => r.status === 'CONFIRMED')
            .reduce((sum, r) => sum + Number(r.amount_cents || 0), 0);
        const commissionDueCents = commission.reduce((sum, c) => sum + Number(c.payable_cents || 0), 0);

        const refundByReceipt = refunds.reduce((map, refund) => {
            if (refund.status !== 'CONFIRMED') return map;
            const key = refund.payment_receipt_id;
            map[key] = (map[key] || 0) + Number(refund.amount_cents || 0);
            return map;
        }, {});

        let html = `
            <div class="finance-kpis">
                <div class="metric-panel">
                    <span>Vendas</span>
                    <strong>R$ ${(salesCents / 100).toFixed(2)}</strong>
                </div>
                <div class="metric-panel">
                    <span>Recebido líquido</span>
                    <strong>R$ ${(receivedCents / 100).toFixed(2)}</strong>
                </div>
                <div class="metric-panel">
                    <span>A receber</span>
                    <strong>R$ ${(dueCents / 100).toFixed(2)}</strong>
                </div>
                <div class="metric-panel">
                    <span>Devoluções</span>
                    <strong>R$ ${(refundedCents / 100).toFixed(2)}</strong>
                </div>
                <div class="metric-panel">
                    <span>Comissões a pagar</span>
                    <strong>R$ ${(commissionDueCents / 100).toFixed(2)}</strong>
                </div>
            </div>
        `;

        if (openCashSession) {
            const expected = Number(openCashSession.expected_cash_now_cents || 0);
            html += `
                <div class="card">
                    <div class="section-heading">
                        <div>
                            <div class="card-title">Caixa aberto</div>
                            <p class="text-muted">Controle físico do dinheiro da unidade.</p>
                        </div>
                        <span class="badge badge-success">ABERTO</span>
                    </div>

                    <div class="cash-summary">
                        <div><span>Fundo inicial</span><strong>R$ ${(Number(openCashSession.opening_cash_cents || 0) / 100).toFixed(2)}</strong></div>
                        <div><span>Esperado agora</span><strong>R$ ${(expected / 100).toFixed(2)}</strong></div>
                    </div>

                    <div class="button-group">
                        <button class="button button-secondary"
                            data-kira-action="openCashAdjustmentDialog('${openCashSession.cash_session_id}')">
                            Movimento de caixa
                        </button>
                        <button class="button button-danger"
                            data-kira-action="openCloseCashDialog('${openCashSession.cash_session_id}')">
                            Fechar caixa
                        </button>
                    </div>
                </div>
            `;
        } else {
            const lastSession = cash[0] || null;
            html += `
                <div class="card">
                    <div class="section-heading">
                        <div>
                            <div class="card-title">Caixa</div>
                            <p class="text-muted">
                                ${lastSession ? 'Última sessão encerrada. Abra um novo caixa para movimentações em dinheiro.' : 'Nenhuma sessão de caixa registrada.'}
                            </p>
                        </div>
                        <span class="badge badge-warning">FECHADO</span>
                    </div>
                    <button class="button button-primary" data-kira-action="openCashDialog()">Abrir caixa</button>
                </div>
            `;
        }

        html += `
            <div class="card">
                <div class="card-title">Comandas</div>
                ${orders.length ? `
                    <div class="table-wrap">
                        <table>
                            <thead>
                                <tr>
                                    <th>Cliente</th>
                                    <th>Total</th>
                                    <th>Pago</th>
                                    <th>Saldo</th>
                                    <th>Pagamento</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${orders.map(order => {
                                    const agendaItem = agenda.find(a => a.appointment_id === order.appointment_id);
                                    const customerName = agendaItem?.customer_name || `Atendimento ${String(order.order_id || '').slice(0, 8)}`;
                                    const orderReceipts = receipts.filter(r => r.order_id === order.order_id);

                                    const receiptDetails = orderReceipts.length ? `
                                        <details class="transaction-details">
                                            <summary>${orderReceipts.length} ${orderReceipts.length === 1 ? 'lançamento' : 'lançamentos'}</summary>
                                            <div class="transaction-list">
                                                ${orderReceipts.map(receipt => {
                                                    const alreadyRefunded = refundByReceipt[receipt.id] || 0;
                                                    const refundable = Math.max(Number(receipt.amount_cents || 0) - alreadyRefunded, 0);
                                                    const canRefund = appState.userRole === 'OWNER' && refundable > 0;

                                                    return `
                                                        <div class="transaction-row">
                                                            <div>
                                                                <strong>${sanitizeText(receipt.method || '—')}</strong>
                                                                <span>R$ ${(Number(receipt.amount_cents || 0) / 100).toFixed(2)}</span>
                                                                ${alreadyRefunded > 0 ? `<small>Devolvido: R$ ${(alreadyRefunded / 100).toFixed(2)}</small>` : ''}
                                                            </div>
                                                            ${canRefund ? `
                                                                <button class="button button-secondary compact-action"
                                                                    data-kira-action="openRefundDialog('${receipt.id}', ${refundable}, '${sanitizeText(receipt.method || '')}')">
                                                                    Devolver
                                                                </button>
                                                            ` : ''}
                                                        </div>
                                                    `;
                                                }).join('')}
                                            </div>
                                        </details>
                                    ` : '<span class="text-muted">Sem lançamentos</span>';

                                    return `
                                        <tr>
                                            <td>${sanitizeText(customerName)}</td>
                                            <td>R$ ${(Number(order.total_cents || 0) / 100).toFixed(2)}</td>
                                            <td>R$ ${(Number(order.paid_cents || 0) / 100).toFixed(2)}</td>
                                            <td>R$ ${(Number(order.balance_cents || 0) / 100).toFixed(2)}</td>
                                            <td>
                                                ${Number(order.balance_cents || 0) > 0 ? `
                                                    <button class="button button-primary compact-action"
                                                        data-kira-action="openCheckoutDialog('${order.appointment_id}', ${Number(order.balance_cents || 0)})">
                                                        Receber
                                                    </button>
                                                ` : '<span class="badge badge-success">QUITADO</span>'}
                                                ${receiptDetails}
                                            </td>
                                        </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                ` : '<p class="text-muted">Nenhuma comanda aberta ou concluída.</p>'}
            </div>
        `;

        html += `
            <div class="card">
                <div class="card-title">Comissões</div>
                ${commission.length ? `
                    <div class="table-wrap">
                        <table>
                            <thead>
                                <tr>
                                    <th>Profissional</th>
                                    <th>Apurada</th>
                                    <th>Ajustes</th>
                                    <th>Repassada</th>
                                    <th>A pagar</th>
                                    <th>Ação</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${commission.map(c => {
                                    const payable = Number(c.payable_cents || 0);
                                    return `
                                        <tr>
                                            <td>${sanitizeText(c.display_name || '—')}</td>
                                            <td>R$ ${(Number(c.accrued_cents || 0) / 100).toFixed(2)}</td>
                                            <td>R$ ${(Number(c.adjustment_cents || 0) / 100).toFixed(2)}</td>
                                            <td>R$ ${(Number(c.paid_out_cents || 0) / 100).toFixed(2)}</td>
                                            <td><strong>R$ ${(payable / 100).toFixed(2)}</strong></td>
                                            <td>
                                                ${appState.userRole === 'OWNER' && payable > 0 ? `
                                                    <button class="button button-secondary compact-action"
                                                        data-kira-action="openCommissionPayoutDialog(
                                                            '${c.professional_id}',
                                                            '${sanitizeText(c.display_name || 'Profissional')}',
                                                            ${payable}
                                                        )">
                                                        Registrar repasse
                                                    </button>
                                                ` : '—'}
                                            </td>
                                        </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                ` : '<p class="text-muted">Nenhuma comissão apurada.</p>'}
            </div>
        `;

        if (movements.length) {
            const labels = {
                OPENING_FLOAT: 'Abertura',
                CASH_PAYMENT: 'Recebimento',
                EXPENSE: 'Despesa',
                WITHDRAWAL: 'Sangria',
                SUPPLY: 'Suprimento',
                ADJUSTMENT: 'Ajuste'
            };

            html += `
                <div class="card">
                    <div class="card-title">Últimos movimentos de caixa</div>
                    <div class="table-wrap">
                        <table>
                            <thead>
                                <tr>
                                    <th>Tipo</th>
                                    <th>Valor</th>
                                    <th>Observação</th>
                                    <th>Data</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${movements.slice(0, 12).map(m => `
                                    <tr>
                                        <td>${sanitizeText(labels[m.kind] || m.kind || '—')}</td>
                                        <td class="${Number(m.amount_cents || 0) < 0 ? 'amount-negative' : 'amount-positive'}">
                                            R$ ${(Number(m.amount_cents || 0) / 100).toFixed(2)}
                                        </td>
                                        <td>${sanitizeText(m.note || '—')}</td>
                                        <td>${new Date(m.created_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        }

        content.innerHTML = `<div class="content-inner">${html}</div>`;
    } catch (error) {
        console.error('Financial page error:', error);
        content.innerHTML = `
            <div class="content-inner">
                <div class="alert alert-error">
                    Erro ao carregar financeiro: ${sanitizeText(error.message || 'erro desconhecido')}
                </div>
            </div>
        `;
    }
}

function openCashDialog() {
    const content = document.getElementById('content');
    content.innerHTML = `
        <div class="content-inner">
            <div class="card" style="max-width: 400px;">
                <div class="card-title">Abrir caixa</div>
                
                <div class="form-group">
                    <label>Fundo de caixa (R$)</label>
                    <input type="number" id="opening-cash" placeholder="100,00" step="0.01" min="0" value="0.00">
                </div>

                <div class="button-group">
                    <button class="button button-primary" id="open-cash-submit" data-kira-action="submitOpenCash()">Abrir</button>
                    <button class="button button-secondary" data-kira-action="navigateTo('financeiro')">Cancelar</button>
                </div>
            </div>
        </div>
    `;
}

async function submitOpenCash() {
    const requestKey = 'open-cash';
    const button = document.getElementById('open-cash-submit');

    if (financialMutationRequests.has(requestKey)) return;

    try {
        const openingCashReais = parseFloat(document.getElementById('opening-cash').value);

        if (isNaN(openingCashReais) || openingCashReais < 0) {
            showAlert('Digite um valor válido', 'error');
            return;
        }

        financialMutationRequests.add(requestKey);
        setFinancialButtonBusy(button, true, 'Abrindo...');

        const openingCashCents = Math.round(openingCashReais * 100);

        await postFinancialAction({
            action: 'open-cash',
            opening_cash_cents: openingCashCents
        });

        await refreshFinancialWorkspace();
        showAlert('Caixa aberto com sucesso', 'success');
        await renderFinancialPage();
    } catch (error) {
        console.error('Open cash error:', error);
        showAlert('Erro ao abrir caixa: ' + error.message, 'error');

        if (/sessão expirou/i.test(error.message || '')) {
            navigateTo('acesso-interno');
        }
    } finally {
        financialMutationRequests.delete(requestKey);

        if (button && document.body.contains(button)) {
            setFinancialButtonBusy(button, false);
        }
    }
}

function openCloseCashDialog(cashSessionId) {
    const content = document.getElementById('content');
    content.innerHTML = `
        <div class="content-inner">
            <div class="card" style="max-width: 400px;">
                <div class="card-title">Fechar caixa</div>
                
                <div class="form-group">
                    <label>Valor contado (R$)</label>
                    <input type="number" id="counted-cash" placeholder="150,00" step="0.01" min="0">
                </div>

                <div class="button-group">
                    <button class="button button-primary" id="close-cash-submit" data-kira-action="submitCloseCash('${cashSessionId}')">Fechar</button>
                    <button class="button button-secondary" data-kira-action="navigateTo('financeiro')">Cancelar</button>
                </div>
            </div>
        </div>
    `;
}

async function submitCloseCash(cashSessionId) {
    const requestKey = `close-cash:${cashSessionId}`;
    const button = document.getElementById('close-cash-submit');

    if (financialMutationRequests.has(requestKey)) return;

    try {
        const countedCashReais = parseFloat(document.getElementById('counted-cash').value);

        if (isNaN(countedCashReais) || countedCashReais < 0) {
            showAlert('Digite um valor válido', 'error');
            return;
        }

        financialMutationRequests.add(requestKey);
        setFinancialButtonBusy(button, true, 'Fechando...');

        const countedCashCents = Math.round(countedCashReais * 100);

        const payload = await postFinancialAction({
            action: 'close-cash',
            cash_session_id: cashSessionId,
            counted_cash_cents: countedCashCents
        });

        await refreshFinancialWorkspace();

        const difference = Number(payload?.result?.difference_cents ?? 0);
        const differenceText = new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL'
        }).format(difference / 100);

        showAlert(
            `Caixa fechado com sucesso. Diferença: ${differenceText}`,
            difference === 0 ? 'success' : 'info'
        );

        await renderFinancialPage();
    } catch (error) {
        console.error('Close cash error:', error);
        showAlert('Erro ao fechar caixa: ' + error.message, 'error');

        if (/sessão expirou/i.test(error.message || '')) {
            navigateTo('acesso-interno');
        }
    } finally {
        financialMutationRequests.delete(requestKey);

        if (button && document.body.contains(button)) {
            setFinancialButtonBusy(button, false);
        }
    }
}

function openCheckoutDialog(appointmentId, balanceCents) {
    const content = document.getElementById('content');
    const financial = appState.workspaceData?.financial || {};
    const cash = financial.cash || [];
    const openCashSession = cash.find(session => session.status === 'OPEN');
    const balanceReais = (balanceCents / 100).toFixed(2);
    
    content.innerHTML = `
        <div class="content-inner">
            <div class="card" style="max-width: 500px;">
                <div class="card-title">Recebimento</div>
                
                <div class="form-group">
                    <label>Valor a receber (R$)</label>
                    <input type="text" value="${balanceReais}" readonly style="background: #f5f5f5;">
                </div>

                <div class="form-group">
                    <label>Método de pagamento</label>
                    <select id="payment-method">
                        <option value="">Selecione</option>
                        <option value="PIX">PIX</option>
                        <option value="CASH">Dinheiro</option>
                        <option value="CARD">Cartão</option>
                        <option value="OTHER">Outro</option>
                    </select>
                </div>

                <div class="form-group">
                    <label>Valor recebido (R$)</label>
                    <input type="number" id="payment-amount" placeholder="0,00" step="0.01" min="0" value="${balanceReais}">
                </div>

                <div id="cash-warning" style="display: none; margin-bottom: 1rem;">
                    <div class="alert alert-error">Abra o caixa antes de registrar pagamento em dinheiro.</div>
                </div>

                <div class="button-group">
                    <button class="button button-primary" id="checkout-submit" data-kira-action="submitCheckout('${appointmentId}')">Registrar pagamento</button>
                    <button class="button button-secondary" data-kira-action="navigateTo('financeiro')">Cancelar</button>
                </div>
            </div>
        </div>
    `;

    document.getElementById('payment-method').addEventListener('change', (e) => {
        if (e.target.value === 'CASH') {
            if (!openCashSession) {
                document.getElementById('cash-warning').style.display = 'block';
                document.getElementById('payment-amount').disabled = true;
                document.querySelector('.button-primary').disabled = true;
            } else {
                document.getElementById('cash-warning').style.display = 'none';
                document.getElementById('payment-amount').disabled = false;
                document.querySelector('.button-primary').disabled = false;
            }
        } else {
            document.getElementById('cash-warning').style.display = 'none';
            document.getElementById('payment-amount').disabled = false;
            document.querySelector('.button-primary').disabled = false;
        }
    });
}

async function submitCheckout(appointmentId) {
    const requestKey = `checkout:${appointmentId}`;
    const button = document.getElementById('checkout-submit');

    if (financialMutationRequests.has(requestKey)) return;

    try {
        const method = document.getElementById('payment-method').value;
        const amountReais = parseFloat(document.getElementById('payment-amount').value);

        if (!method || isNaN(amountReais) || amountReais <= 0) {
            showAlert('Preencha os dados corretamente', 'error');
            return;
        }

        const amountCents = Math.round(amountReais * 100);
        const financial = appState.workspaceData?.financial || {};
        const openCashSession = (financial.cash || [])
            .find(session => session.status === 'OPEN');

        if (method === 'CASH' && !openCashSession) {
            showAlert(
                'Abra o caixa antes de registrar pagamento em dinheiro',
                'error'
            );
            return;
        }

        financialMutationRequests.add(requestKey);
        setFinancialButtonBusy(button, true, 'Registrando...');

        // A mesma chave é preservada inclusive se houver retry após 401.
        const idempotencyKey = crypto.randomUUID();

        const payload = await postFinancialAction({
            action: 'checkout',
            appointment_id: appointmentId,
            discount_cents: 0,
            payments: [{
                method,
                amount_cents: amountCents
            }],
            cash_session_id:
                method === 'CASH'
                    ? openCashSession.cash_session_id
                    : null,
            idempotency_key: idempotencyKey
        });

        const result = payload.result || {};
        const paid = Number(result.paid_cents || 0);
        const balance = Number(result.balance_cents || 0);
        const status = String(result.status || 'pendente');

        await refreshFinancialWorkspace();

        const money = (cents) => new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL'
        }).format(Number(cents || 0) / 100);

        showAlert(
            `Pagamento registrado. Status: ${status} · Recebido: ${money(paid)} · Saldo: ${money(balance)}`,
            'success'
        );

        await renderFinancialPage();
    } catch (error) {
        console.error('Checkout error:', error);
        showAlert('Erro ao registrar pagamento: ' + error.message, 'error');

        if (/sessão expirou/i.test(error.message || '')) {
            navigateTo('acesso-interno');
        }
    } finally {
        financialMutationRequests.delete(requestKey);

        if (button && document.body.contains(button)) {
            setFinancialButtonBusy(button, false);
        }
    }
}

function openCashAdjustmentDialog(cashSessionId) {
    const content = document.getElementById('content');
    content.innerHTML = `
        <div class="content-inner">
            <div class="card form-card">
                <div class="card-title">Movimento de caixa</div>
                <div class="form-group">
                    <label>Tipo</label>
                    <select id="cash-adjustment-kind">
                        <option value="">Selecione</option>
                        <option value="EXPENSE">Despesa</option>
                        <option value="WITHDRAWAL">Sangria</option>
                        <option value="SUPPLY">Suprimento</option>
                        <option value="ADJUSTMENT">Ajuste manual</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Valor (R$)</label>
                    <input type="number" id="cash-adjustment-amount" step="0.01" placeholder="0,00">
                    <small class="field-help">Para ajuste manual, valores negativos reduzem o caixa.</small>
                </div>
                <div class="form-group">
                    <label>Observação</label>
                    <input type="text" id="cash-adjustment-note" maxlength="180" placeholder="Motivo do movimento">
                </div>
                <div class="button-group">
                    <button class="button button-primary" id="cash-adjustment-submit"
                        data-kira-action="submitCashAdjustment('${cashSessionId}')">Registrar</button>
                    <button class="button button-secondary" data-kira-action="navigateTo('financeiro')">Cancelar</button>
                </div>
            </div>
        </div>
    `;
}

async function submitCashAdjustment(cashSessionId) {
    const requestKey = `cash-adjustment:${cashSessionId}`;
    const button = document.getElementById('cash-adjustment-submit');

    if (financialMutationRequests.has(requestKey)) return;

    try {
        const kind = document.getElementById('cash-adjustment-kind').value;
        const amountReais = Number(document.getElementById('cash-adjustment-amount').value);
        const note = document.getElementById('cash-adjustment-note').value.trim();

        if (!kind || !Number.isFinite(amountReais) || amountReais === 0 || !note) {
            showAlert('Preencha tipo, valor e observação', 'error');
            return;
        }

        let amountCents = Math.round(amountReais * 100);
        if (kind !== 'ADJUSTMENT') {
            amountCents = Math.abs(amountCents);
        }

        financialMutationRequests.add(requestKey);
        setFinancialButtonBusy(button, true, 'Registrando...');

        await postFinancialAction({
            action: 'cash-adjustment',
            cash_session_id: cashSessionId,
            kind,
            amount_cents: amountCents,
            note
        });

        await refreshFinancialWorkspace();
        showAlert('Movimento de caixa registrado', 'success');
        await renderFinancialPage();
    } catch (error) {
        console.error('Cash adjustment error:', error);
        showAlert('Erro no movimento de caixa: ' + error.message, 'error');

        if (/sessão expirou/i.test(error.message || '')) {
            navigateTo('acesso-interno');
        }
    } finally {
        financialMutationRequests.delete(requestKey);

        if (button && document.body.contains(button)) {
            setFinancialButtonBusy(button, false);
        }
    }
}

function openRefundDialog(receiptId, refundableCents, method) {
    if (appState.userRole !== 'OWNER') {
        showAlert('Somente o proprietário pode registrar devoluções', 'error');
        return;
    }

    const openCashSession = (appState.workspaceData?.financial?.cash || [])
        .find(session => session.status === 'OPEN') || null;
    const cashBlocked = method === 'CASH' && !openCashSession;

    const content = document.getElementById('content');
    content.innerHTML = `
        <div class="content-inner">
            <div class="card form-card">
                <div class="card-title">Registrar devolução</div>
                <p class="text-muted">Disponível neste recebimento: R$ ${(Number(refundableCents || 0) / 100).toFixed(2)}</p>

                ${cashBlocked ? `
                    <div class="alert alert-warning">
                        Para devolver um recebimento em dinheiro, abra o caixa primeiro.
                    </div>
                ` : ''}

                <div class="form-group">
                    <label>Valor da devolução (R$)</label>
                    <input type="number" id="refund-amount" step="0.01" min="0.01"
                        max="${(Number(refundableCents || 0) / 100).toFixed(2)}"
                        value="${(Number(refundableCents || 0) / 100).toFixed(2)}">
                </div>

                <div class="form-group">
                    <label>Motivo</label>
                    <input type="text" id="refund-reason" maxlength="180"
                        placeholder="Ex.: correção de cobrança">
                </div>

                <div class="button-group">
                    <button class="button button-primary" id="refund-submit"
                        ${cashBlocked ? 'disabled' : ''}
                        data-kira-action="submitRefund('${receiptId}', ${Number(refundableCents || 0)}, '${method}')">
                        Confirmar devolução
                    </button>
                    <button class="button button-secondary" data-kira-action="navigateTo('financeiro')">Cancelar</button>
                </div>
            </div>
        </div>
    `;
}

async function submitRefund(receiptId, refundableCents, method) {
    const requestKey = `refund:${receiptId}`;
    const button = document.getElementById('refund-submit');

    if (financialMutationRequests.has(requestKey)) return;

    try {
        const amountReais = Number(document.getElementById('refund-amount').value);
        const reason = document.getElementById('refund-reason').value.trim();
        const amountCents = Math.round(amountReais * 100);

        if (!Number.isFinite(amountReais) || amountCents <= 0 || amountCents > refundableCents) {
            showAlert('Valor de devolução inválido', 'error');
            return;
        }

        if (reason.length < 3) {
            showAlert('Informe o motivo da devolução', 'error');
            return;
        }

        const openCashSession = (appState.workspaceData?.financial?.cash || [])
            .find(session => session.status === 'OPEN') || null;

        if (method === 'CASH' && !openCashSession) {
            showAlert('Abra o caixa antes da devolução em dinheiro', 'error');
            return;
        }

        financialMutationRequests.add(requestKey);
        setFinancialButtonBusy(button, true, 'Devolvendo...');

        await postFinancialAction({
            action: 'refund',
            payment_receipt_id: receiptId,
            amount_cents: amountCents,
            reason,
            cash_session_id:
                method === 'CASH'
                    ? openCashSession.cash_session_id
                    : null
        });

        await refreshFinancialWorkspace();
        showAlert(
            'Devolução registrada e comissão compensada',
            'success'
        );
        await renderFinancialPage();
    } catch (error) {
        console.error('Refund error:', error);
        showAlert('Erro ao registrar devolução: ' + error.message, 'error');

        if (/sessão expirou/i.test(error.message || '')) {
            navigateTo('acesso-interno');
        }
    } finally {
        financialMutationRequests.delete(requestKey);

        if (button && document.body.contains(button)) {
            setFinancialButtonBusy(button, false);
        }
    }
}

function openCommissionPayoutDialog(professionalId, displayName, payableCents) {
    if (appState.userRole !== 'OWNER') {
        showAlert('Somente o proprietário pode registrar repasses', 'error');
        return;
    }

    const content = document.getElementById('content');
    content.innerHTML = `
        <div class="content-inner">
            <div class="card form-card">
                <div class="card-title">Repasse de comissão</div>
                <p class="text-muted">
                    ${sanitizeText(displayName)} · disponível R$ ${(Number(payableCents || 0) / 100).toFixed(2)}
                </p>

                <div class="form-group">
                    <label>Valor (R$)</label>
                    <input type="number" id="payout-amount" step="0.01" min="0.01"
                        max="${(Number(payableCents || 0) / 100).toFixed(2)}"
                        value="${(Number(payableCents || 0) / 100).toFixed(2)}">
                </div>

                <div class="form-group">
                    <label>Forma do repasse</label>
                    <select id="payout-method">
                        <option value="PIX">PIX</option>
                        <option value="CASH">Dinheiro</option>
                        <option value="OTHER">Outro</option>
                    </select>
                </div>

                <div class="form-group">
                    <label>Observação</label>
                    <input type="text" id="payout-note" maxlength="180"
                        placeholder="Opcional">
                </div>

                <div id="payout-cash-warning"></div>

                <div class="button-group">
                    <button class="button button-primary" id="payout-submit"
                        data-kira-action="submitCommissionPayout('${professionalId}', ${Number(payableCents || 0)})">
                        Registrar repasse
                    </button>
                    <button class="button button-secondary" data-kira-action="navigateTo('financeiro')">Cancelar</button>
                </div>
            </div>
        </div>
    `;

    const method = document.getElementById('payout-method');
    const syncCashState = () => {
        const openCashSession = (appState.workspaceData?.financial?.cash || [])
            .find(session => session.status === 'OPEN') || null;
        const needsCash = method.value === 'CASH';
        const blocked = needsCash && !openCashSession;
        document.getElementById('payout-submit').disabled = blocked;
        document.getElementById('payout-cash-warning').innerHTML = blocked
            ? '<div class="alert alert-warning">Abra o caixa antes de registrar repasse em dinheiro.</div>'
            : '';
    };
    method.addEventListener('change', syncCashState);
    syncCashState();
}

async function submitCommissionPayout(professionalId, payableCents) {
    const requestKey = `commission-payout:${professionalId}`;
    const button = document.getElementById('payout-submit');

    if (financialMutationRequests.has(requestKey)) return;

    try {
        const amountReais = Number(document.getElementById('payout-amount').value);
        const method = document.getElementById('payout-method').value;
        const note = document.getElementById('payout-note').value.trim();
        const amountCents = Math.round(amountReais * 100);

        if (!Number.isFinite(amountReais) || amountCents <= 0 || amountCents > payableCents) {
            showAlert('Valor de repasse inválido', 'error');
            return;
        }

        const openCashSession = (appState.workspaceData?.financial?.cash || [])
            .find(session => session.status === 'OPEN') || null;

        if (method === 'CASH' && !openCashSession) {
            showAlert('Abra o caixa antes do repasse em dinheiro', 'error');
            return;
        }

        financialMutationRequests.add(requestKey);
        setFinancialButtonBusy(button, true, 'Registrando...');

        await postFinancialAction({
            action: 'commission-payout',
            professional_id: professionalId,
            amount_cents: amountCents,
            method,
            note,
            cash_session_id:
                method === 'CASH'
                    ? openCashSession.cash_session_id
                    : null
        });

        await refreshFinancialWorkspace();
        showAlert('Repasse de comissão registrado', 'success');
        await renderFinancialPage();
    } catch (error) {
        console.error('Commission payout error:', error);
        showAlert('Erro ao registrar repasse: ' + error.message, 'error');

        if (/sessão expirou/i.test(error.message || '')) {
            navigateTo('acesso-interno');
        }
    } finally {
        financialMutationRequests.delete(requestKey);

        if (button && document.body.contains(button)) {
            setFinancialButtonBusy(button, false);
        }
    }
}

// KIRA_REPORTS_ACCURACY_V16
function formatReportCurrency(cents) {
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL'
    }).format(Number(cents || 0) / 100);
}

async function renderReportsPage() {
    const content = document.getElementById('content');
    updateTopbar('Relatórios', 'Visão operacional e financeira atual');

    content.innerHTML = `
        <div class="content-inner">
            <div class="ops-loading">
                <div class="loading"></div>
                <span>Atualizando indicadores...</span>
            </div>
        </div>
    `;

    try {
        // Relatórios não devem exibir snapshot antigo do workspace.
        const loaded = await loadWorkspaceData();

        if (!loaded || !appState.workspaceData) {
            throw new Error('Não foi possível carregar os dados atualizados da unidade.');
        }

        const agenda = appState.workspaceData.agenda || [];
        const financial = appState.workspaceData.financial || {};
        const orders = financial.orders || [];
        const commission = await loadVisibleCommissionRows(financial);
        const refunds = financial.refunds || [];
        const payouts = financial.commission_payouts || [];

        const operational = {
            total: agenda.length,
            completed: agenda.filter(a => a.state === 'COMPLETED').length,
            inService: agenda.filter(a => a.state === 'IN_SERVICE').length,
            noShow: agenda.filter(a => a.state === 'NO_SHOW').length,
            cancelled: agenda.filter(a => a.state === 'CANCELLED').length
        };

        const sales = orders.reduce(
            (sum, o) => sum + Number(o.total_cents || 0),
            0
        );

        const received = orders.reduce(
            (sum, o) => sum + Number(o.paid_cents || 0),
            0
        );

        const due = orders.reduce(
            (sum, o) => sum + Number(o.balance_cents || 0),
            0
        );

        const refunded = refunds
            .filter(r => r.status === 'CONFIRMED')
            .reduce(
                (sum, r) => sum + Number(r.amount_cents || 0),
                0
            );

        const commissionDue = commission.reduce(
            (sum, c) => sum + Number(c.payable_cents || 0),
            0
        );

        const paidOut = payouts.reduce(
            (sum, p) => sum + Number(p.amount_cents || 0),
            0
        );

        const updatedAt = new Date().toLocaleString('pt-BR', {
            timeZone: 'America/Sao_Paulo',
            dateStyle: 'short',
            timeStyle: 'short'
        });

        const html = `
            <div class="content-inner reports-pro">
                <section class="module-heading reports-heading">
                    <div>
                        <span>RELATÓRIOS / VISÃO ATUAL</span>
                        <h1>INDICADORES</h1>
                        <p>
                            Leitura operacional da agenda disponível e panorama financeiro
                            carregado para a unidade.
                        </p>
                    </div>

                    <div class="reports-refresh-meta">
                        <span>ATUALIZADO</span>
                        <strong>${sanitizeText(updatedAt)}</strong>
                    </div>
                </section>

                <section class="finance-kpis reports-kpis" aria-label="Indicadores operacionais">
                    <div class="metric-panel">
                        <span>Na agenda</span>
                        <strong>${operational.total}</strong>
                    </div>

                    <div class="metric-panel">
                        <span>Concluídos</span>
                        <strong>${operational.completed}</strong>
                    </div>

                    <div class="metric-panel">
                        <span>Em atendimento</span>
                        <strong>${operational.inService}</strong>
                    </div>

                    <div class="metric-panel">
                        <span>Faltas</span>
                        <strong>${operational.noShow}</strong>
                    </div>

                    <div class="metric-panel">
                        <span>Cancelados</span>
                        <strong>${operational.cancelled}</strong>
                    </div>
                </section>

                <section class="card report-section-card">
                    <div class="report-section-head">
                        <div>
                            <span>FINANCEIRO</span>
                            <div class="card-title">Consolidado financeiro atual</div>
                        </div>

                        <p>
                            Valores consolidados do conjunto financeiro carregado para a unidade.
                        </p>
                    </div>

                    <div class="report-grid">
                        <div>
                            <span>Vendas</span>
                            <strong>${formatReportCurrency(sales)}</strong>
                        </div>

                        <div>
                            <span>Recebido líquido</span>
                            <strong>${formatReportCurrency(received)}</strong>
                        </div>

                        <div>
                            <span>A receber</span>
                            <strong>${formatReportCurrency(due)}</strong>
                        </div>

                        <div>
                            <span>Devoluções</span>
                            <strong>${formatReportCurrency(refunded)}</strong>
                        </div>

                        <div>
                            <span>Repasses registrados</span>
                            <strong>${formatReportCurrency(paidOut)}</strong>
                        </div>

                        <div>
                            <span>Comissões a pagar</span>
                            <strong>${formatReportCurrency(commissionDue)}</strong>
                        </div>
                    </div>
                </section>

                <section class="card report-section-card">
                    <div class="report-section-head">
                        <div>
                            <span>COMISSIONAMENTO</span>
                            <div class="card-title">Comissões por profissional</div>
                        </div>

                        <p>
                            Posição atual de valores apurados, ajustes, repasses e saldo pendente.
                        </p>
                    </div>

                    ${commission.length ? `
                        <div class="table-wrap">
                            <table>
                                <thead>
                                    <tr>
                                        <th>Profissional</th>
                                        <th>Apurada</th>
                                        <th>Ajustes</th>
                                        <th>Repassada</th>
                                        <th>A pagar</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${commission.map(c => `
                                        <tr>
                                            <td>${sanitizeText(c.display_name || '—')}</td>
                                            <td>${formatReportCurrency(c.accrued_cents)}</td>
                                            <td class="${Number(c.adjustment_cents || 0) < 0 ? 'amount-negative' : ''}">
                                                ${formatReportCurrency(c.adjustment_cents)}
                                            </td>
                                            <td>${formatReportCurrency(c.paid_out_cents)}</td>
                                            <td>
                                                <strong>${formatReportCurrency(c.payable_cents)}</strong>
                                            </td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    ` : `
                        <div class="ops-empty">
                            <strong>Nenhuma comissão apurada</strong>
                            <span>Os valores aparecerão aqui após a movimentação financeira dos atendimentos.</span>
                        </div>
                    `}
                </section>
            </div>
        `;

        content.innerHTML = html;
    } catch (error) {
        console.error('Reports page error:', error);

        content.innerHTML = `
            <div class="content-inner">
                <div class="alert alert-error">
                    Erro ao carregar relatórios:
                    ${sanitizeText(error.message || 'erro desconhecido')}
                </div>
            </div>
        `;
    }
}

async function renderConfigurationPage() {
    const content = document.getElementById('content');
    updateTopbar('Configurações', 'Estrutura da unidade');

    if (appState.userRole === 'BARBER') {
        navigateTo('home');
        return;
    }

    content.innerHTML = `
        <div class="content-inner config-pro">
            <section class="module-heading">
                <div>
                    <span>CONFIGURAÇÃO / BROOKLYN</span>
                    <h1>ESTRUTURA DA UNIDADE</h1>
                    <p>Serviços, equipe, expediente, comissão e regras de agendamento.</p>
                </div>
            </section>

            <section class="config-module-grid">
                <button data-kira-action="showServicesConfig()">
                    <b>01</b>
                    <strong>SERVIÇOS</strong>
                    <span>Preço, duração, buffer e disponibilidade.</span>
                    <i>↗</i>
                </button>

                <button data-kira-action="showProfessionalsConfig()">
                    <b>02</b>
                    <strong>PROFISSIONAIS</strong>
                    <span>Equipe ativa e perfis de atendimento.</span>
                    <i>↗</i>
                </button>

                <button data-kira-action="showProfessionalServicesConfig()">
                    <b>03</b>
                    <strong>VÍNCULOS</strong>
                    <span>Quais serviços cada profissional executa.</span>
                    <i>↗</i>
                </button>

                <button data-kira-action="showProfessionalHoursConfig()">
                    <b>04</b>
                    <strong>EXPEDIENTE</strong>
                    <span>Jornada semanal por profissional.</span>
                    <i>↗</i>
                </button>

                ${appState.userRole === 'OWNER' ? `
                    <button data-kira-action="showCommissionRulesConfig()">
                        <b>05</b>
                        <strong>COMISSÕES</strong>
                        <span>Percentuais e base de cálculo.</span>
                        <i>↗</i>
                    </button>

                    <button data-kira-action="showBookingPoliciesConfig()">
                        <b>06</b>
                        <strong>AGENDAMENTO</strong>
                        <span>Políticas e controles do canal público.</span>
                        <i>↗</i>
                    </button>
                ` : ''}
            </section>

            <div id="config-content" class="config-content-pro">
                <div class="config-placeholder">
                    <span>SELECIONE UM MÓDULO</span>
                    <strong>As configurações aparecem aqui.</strong>
                </div>
            </div>
        </div>
    `;
}

// KIRA_CONFIG_OPERATIONS_V18_FINAL
const configurationMutationRequests = new Set();

function escapeConfigAttribute(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function setConfigButtonBusy(button, busy, label = 'Salvando...') {
    if (!button) return;

    if (busy) {
        if (!button.dataset.originalLabel) {
            button.dataset.originalLabel = button.textContent.trim();
        }

        button.disabled = true;
        button.textContent = label;
        button.setAttribute('aria-busy', 'true');
        return;
    }

    button.disabled = false;
    button.removeAttribute('aria-busy');

    if (button.dataset.originalLabel) {
        button.textContent = button.dataset.originalLabel;
    }
}

async function refreshConfigurationWorkspace() {
    appState.workspaceData = null;
    const loaded = await loadWorkspaceData(false);

    if (!loaded || !appState.workspaceData) {
        throw new Error(
            'Alteração salva, mas não foi possível atualizar os dados da unidade.'
        );
    }
}

async function showServicesConfig() {
    const configContent = document.getElementById('config-content');
    const orgId = appState.workspaceData?.organization?.id;

    configContent.innerHTML = `
        <div class="card">
            <div class="ops-loading">
                <div class="loading"></div>
                <span>Carregando serviços...</span>
            </div>
        </div>
    `;

    try {
        const { data: services, error } = await appState.supabaseClient
            .from('services')
            .select('id,name,price_cents,duration_minutes,buffer_after_minutes,active')
            .eq('organization_id', orgId)
            .order('name');

        if (error) throw error;

        configContent.innerHTML = `
            <div class="card config-list-card">
                <div class="config-list-head">
                    <div>
                        <span>CATÁLOGO</span>
                        <div class="card-title">Serviços</div>
                        <p>
                            Edite preço, duração, intervalo e disponibilidade
                            sem remover o histórico financeiro.
                        </p>
                    </div>

                    <button
                        class="button button-primary"
                        data-kira-action="showServiceForm()"
                    >
                        Adicionar serviço
                    </button>
                </div>

                ${(services || []).length ? `
                    <div class="table-wrap">
                        <table>
                            <thead>
                                <tr>
                                    <th>Nome</th>
                                    <th>Preço</th>
                                    <th>Duração</th>
                                    <th>Buffer</th>
                                    <th>Status</th>
                                    <th>Ação</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${(services || []).map(s => `
                                    <tr>
                                        <td>${sanitizeText(s.name)}</td>
                                        <td>
                                            ${new Intl.NumberFormat('pt-BR', {
                                                style: 'currency',
                                                currency: 'BRL'
                                            }).format(Number(s.price_cents || 0) / 100)}
                                        </td>
                                        <td>${Number(s.duration_minutes || 0)} min</td>
                                        <td>${Number(s.buffer_after_minutes || 0)} min</td>
                                        <td>
                                            <span class="config-status ${s.active ? 'is-active' : 'is-inactive'}">
                                                ${s.active ? 'ATIVO' : 'INATIVO'}
                                            </span>
                                        </td>
                                        <td>
                                            <div class="config-row-actions">
                                                <button
                                                    class="button button-secondary compact-action"
                                                    data-kira-action="showServiceForm('${s.id}')"
                                                >
                                                    Editar
                                                </button>

                                                ${appState.userRole === 'OWNER' ? `
                                                    <button
                                                        class="button config-danger-action compact-action"
                                                        data-kira-action="deleteServiceConfig('${s.id}')"
                                                    >
                                                        Excluir
                                                    </button>
                                                ` : ''}
                                            </div>
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                ` : `
                    <div class="ops-empty">
                        <strong>Nenhum serviço cadastrado</strong>
                        <span>Adicione o primeiro item do catálogo da unidade.</span>
                    </div>
                `}
            </div>
        `;
    } catch (error) {
        console.error('Load services error:', error);

        configContent.innerHTML = `
            <div class="alert alert-error">
                Erro ao carregar serviços: ${sanitizeText(error.message)}
            </div>
        `;
    }
}

async function showServiceForm(serviceId = null) {
    const configContent = document.getElementById('config-content');
    const orgId = appState.workspaceData?.organization?.id;

    let service = null;

    if (serviceId) {
        configContent.innerHTML = `
            <div class="card">
                <div class="ops-loading">
                    <div class="loading"></div>
                    <span>Carregando serviço...</span>
                </div>
            </div>
        `;

        const { data, error } = await appState.supabaseClient
            .from('services')
            .select('id,name,price_cents,duration_minutes,buffer_after_minutes,active')
            .eq('organization_id', orgId)
            .eq('id', serviceId)
            .maybeSingle();

        if (error) {
            showAlert('Erro ao carregar serviço: ' + error.message, 'error');
            return showServicesConfig();
        }

        if (!data) {
            showAlert('Serviço não encontrado', 'error');
            return showServicesConfig();
        }

        service = data;
    }

    const price = service
        ? (Number(service.price_cents || 0) / 100).toFixed(2)
        : '';

    configContent.innerHTML = `
        <div class="card form-card config-edit-card">
            <div class="config-form-heading">
                <span>${service ? 'EDIÇÃO' : 'NOVO ITEM'}</span>
                <div class="card-title">
                    ${service ? 'Editar serviço' : 'Novo serviço'}
                </div>
            </div>

            <input
                type="hidden"
                id="service-id"
                value="${service?.id || ''}"
            >

            <div class="form-group">
                <label>Nome</label>
                <input
                    type="text"
                    id="service-name"
                    maxlength="120"
                    autocomplete="off"
                    placeholder="Nome do serviço"
                    value="${escapeConfigAttribute(service?.name || '')}"
                >
            </div>

            <div class="form-group">
                <label>Preço (R$)</label>
                <input
                    type="number"
                    id="service-price"
                    placeholder="0,00"
                    step="0.01"
                    min="0"
                    value="${price}"
                >
            </div>

            <div class="config-form-grid">
                <div class="form-group">
                    <label>Duração (minutos)</label>
                    <input
                        type="number"
                        id="service-duration"
                        step="1"
                        min="5"
                        max="720"
                        value="${service?.duration_minutes ?? 45}"
                    >
                </div>

                <div class="form-group">
                    <label>Buffer após atendimento</label>
                    <input
                        type="number"
                        id="service-buffer"
                        step="1"
                        min="0"
                        max="120"
                        value="${service?.buffer_after_minutes ?? 0}"
                    >
                </div>
            </div>

            <label class="config-toggle-row">
                <input
                    type="checkbox"
                    id="service-active"
                    ${service ? (service.active ? 'checked' : '') : 'checked'}
                >
                <span>
                    <strong>Serviço ativo</strong>
                    <small>
                        Serviços inativos ficam fora do catálogo público,
                        mas o histórico é preservado.
                    </small>
                </span>
            </label>

            <div class="button-group">
                <button
                    class="button button-primary"
                    id="service-save-submit"
                    data-kira-action="submitServiceForm()"
                >
                    ${service ? 'Salvar alterações' : 'Criar serviço'}
                </button>

                <button
                    class="button button-secondary"
                    data-kira-action="showServicesConfig()"
                >
                    Cancelar
                </button>
            </div>
        </div>
    `;
}

function showAddServiceForm() {
    return showServiceForm();
}

async function submitServiceForm() {
    const serviceId = document.getElementById('service-id')?.value || null;
    const requestKey = `service:${serviceId || 'new'}`;
    const button = document.getElementById('service-save-submit');

    if (configurationMutationRequests.has(requestKey)) return;

    try {
        const name = document.getElementById('service-name').value.trim();
        const priceReais = Number(document.getElementById('service-price').value);
        const duration = Number(document.getElementById('service-duration').value);
        const buffer = Number(document.getElementById('service-buffer').value);
        const active = document.getElementById('service-active').checked;
        const orgId = appState.workspaceData?.organization?.id;

        if (!name || name.length < 2) {
            showAlert('Informe o nome do serviço', 'error');
            return;
        }

        if (!Number.isFinite(priceReais) || priceReais < 0) {
            showAlert('Informe um preço válido', 'error');
            return;
        }

        if (
            !Number.isInteger(duration) ||
            duration < 5 ||
            duration > 720
        ) {
            showAlert('A duração deve ficar entre 5 e 720 minutos', 'error');
            return;
        }

        if (
            !Number.isInteger(buffer) ||
            buffer < 0 ||
            buffer > 120
        ) {
            showAlert('O buffer deve ficar entre 0 e 120 minutos', 'error');
            return;
        }

        let duplicateQuery = appState.supabaseClient
            .from('services')
            .select('id')
            .eq('organization_id', orgId)
            .ilike('name', name)
            .limit(1);

        if (serviceId) {
            duplicateQuery = duplicateQuery.neq('id', serviceId);
        }

        const { data: duplicate, error: duplicateError } =
            await duplicateQuery.maybeSingle();

        if (duplicateError) throw duplicateError;

        if (duplicate) {
            showAlert('Já existe um serviço com esse nome', 'error');
            return;
        }

        configurationMutationRequests.add(requestKey);
        setConfigButtonBusy(
            button,
            true,
            serviceId ? 'Salvando...' : 'Criando...'
        );

        const payload = {
            name,
            price_cents: Math.round(priceReais * 100),
            duration_minutes: duration,
            buffer_after_minutes: buffer,
            active
        };

        let result;

        if (serviceId) {
            result = await appState.supabaseClient
                .from('services')
                .update(payload)
                .eq('organization_id', orgId)
                .eq('id', serviceId);
        } else {
            result = await appState.supabaseClient
                .from('services')
                .insert([{
                    organization_id: orgId,
                    ...payload
                }]);
        }

        if (result.error) throw result.error;

        await refreshConfigurationWorkspace();

        showAlert(
            serviceId
                ? 'Serviço atualizado com sucesso'
                : 'Serviço criado com sucesso',
            'success'
        );

        await showServicesConfig();
    } catch (error) {
        console.error('Save service error:', error);
        showAlert('Erro ao salvar serviço: ' + error.message, 'error');
    } finally {
        configurationMutationRequests.delete(requestKey);

        if (button && document.body.contains(button)) {
            setConfigButtonBusy(button, false);
        }
    }
}

async function deleteServiceConfig(serviceId) {
    if (appState.userRole !== 'OWNER') {
        showAlert('Somente o proprietário pode excluir serviços', 'error');
        return;
    }

    const requestKey = `delete-service:${serviceId}`;

    if (configurationMutationRequests.has(requestKey)) return;

    try {
        const orgId = appState.workspaceData?.organization?.id;

        const { data: service, error: loadError } = await appState.supabaseClient
            .from('services')
            .select('id,name,active')
            .eq('organization_id', orgId)
            .eq('id', serviceId)
            .maybeSingle();

        if (loadError) throw loadError;

        if (!service) {
            showAlert('Serviço não encontrado', 'error');
            return;
        }

        const confirmed = window.confirm(
            `Excluir "${service.name}" permanentemente?\n\n` +
            'Se o serviço já possuir atendimentos ou registros financeiros, ' +
            'o sistema bloqueará a exclusão. Nesse caso, deixe-o inativo.'
        );

        if (!confirmed) return;

        configurationMutationRequests.add(requestKey);

        const { error } = await appState.supabaseClient
            .from('services')
            .delete()
            .eq('organization_id', orgId)
            .eq('id', serviceId);

        if (error) {
            if (error.code === '23503') {
                showAlert(
                    'Este serviço possui histórico e não pode ser excluído. Edite-o e marque como inativo.',
                    'error'
                );
                return;
            }

            throw error;
        }

        await refreshConfigurationWorkspace();
        showAlert('Serviço excluído com sucesso', 'success');
        await showServicesConfig();
    } catch (error) {
        console.error('Delete service error:', error);
        showAlert('Erro ao excluir serviço: ' + error.message, 'error');
    } finally {
        configurationMutationRequests.delete(requestKey);
    }
}

// Compatibilidade com versões anteriores.
async function submitAddService() {
    return submitServiceForm();
}

// KIRA_PROFESSIONAL_VISIBILITY_V24_1
function filterCommissionRowsForProfessionals(commission, professionals) {
    const activeIds = new Set(
        professionals.filter(p => p.active === true).map(p => p.id)
    );
    const amountFields = [
        'accrued_cents', 'adjustment_cents', 'paid_out_cents', 'payable_cents'
    ];

    return commission.filter(row =>
        activeIds.has(row.professional_id) ||
        amountFields.some(field => {
            const value = Number(row[field] ?? 0);
            // Preserve malformed values rather than silently hiding financial data.
            return !Number.isFinite(value) || value !== 0;
        })
    );
}

async function loadVisibleCommissionRows(financial) {
    const commission = financial.commission || [];
    if (!commission.length) return [];

    const orgId = appState.workspaceData?.organization?.id;
    if (!orgId) throw new Error('Unidade não identificada.');

    const { data: professionals, error } = await appState.supabaseClient
        .from('professionals')
        .select('id,active')
        .eq('organization_id', orgId);

    if (error) throw error;
    return filterCommissionRowsForProfessionals(commission, professionals || []);
}

// KIRA_PROFESSIONAL_ARCHIVE_V18_1
async function showProfessionalsConfig() {
    const configContent = document.getElementById('config-content');
    const orgId = appState.workspaceData?.organization?.id;

    configContent.innerHTML = `
        <div class="card">
            <div class="ops-loading">
                <div class="loading"></div>
                <span>Carregando profissionais...</span>
            </div>
        </div>
    `;

    try {
        const { data: professionals, error } = await appState.supabaseClient
            .from('professionals')
            .select('id,display_name,active,auth_user_id')
            .eq('organization_id', orgId)
            .eq('active', true)
            .order('display_name');

        if (error) throw error;

        const activeProfessionals = (professionals || []).filter(p => p.active);

        configContent.innerHTML = `
            <div class="card config-list-card">
                <div class="config-list-head">
                    <div>
                        <span>EQUIPE</span>
                        <div class="card-title">Profissionais</div>
                        <p>
                            Gerencie os profissionais ativos da equipe.
                        </p>
                    </div>

                    <button class="button button-primary" data-kira-action="showProfessionalForm()">
                        Adicionar profissional
                    </button>
                </div>

                ${activeProfessionals.length ? `
                    <div class="table-wrap">
                        <table>
                            <thead>
                                <tr>
                                    <th>Nome</th>
                                    <th>Status</th>
                                    <th>Acesso</th>
                                    <th>Ação</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${activeProfessionals.map(p => `
                                    <tr>
                                        <td>${sanitizeText(p.display_name)}</td>
                                        <td><span class="config-status is-active">ATIVO</span></td>
                                        <td>
                                            ${p.auth_user_id
                                                ? '<span class="config-access-linked">VINCULADO</span>'
                                                : '<span class="text-muted">Sem login</span>'
                                            }
                                        </td>
                                        <td>
                                            <div class="config-row-actions">
                                                <button
                                                    class="button button-secondary compact-action"
                                                    data-kira-action="showProfessionalForm('${p.id}')"
                                                >
                                                    Editar
                                                </button>

                                                ${appState.userRole === 'OWNER' ? `
                                                    <button
                                                        class="button config-danger-action compact-action"
                                                        data-kira-action="deleteProfessionalConfig('${p.id}')"
                                                    >
                                                        Excluir
                                                    </button>
                                                ` : ''}
                                            </div>
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                ` : `
                    <div class="ops-empty">
                        <strong>Nenhum profissional ativo</strong>
                        <span>Adicione um profissional para começar.</span>
                    </div>
                `}


            </div>
        `;
    } catch (error) {
        console.error('Load professionals error:', error);
        configContent.innerHTML = `
            <div class="alert alert-error">
                Erro ao carregar profissionais: ${sanitizeText(error.message)}
            </div>
        `;
    }
}

async function showProfessionalForm(professionalId = null) {
    const configContent = document.getElementById('config-content');
    const orgId = appState.workspaceData?.organization?.id;

    let professional = null;

    if (professionalId) {
        configContent.innerHTML = `
            <div class="card">
                <div class="ops-loading">
                    <div class="loading"></div>
                    <span>Carregando profissional...</span>
                </div>
            </div>
        `;

        const { data, error } = await appState.supabaseClient
            .from('professionals')
            .select('id,display_name,active,auth_user_id')
            .eq('organization_id', orgId)
            .eq('id', professionalId)
            .maybeSingle();

        if (error) {
            showAlert('Erro ao carregar profissional: ' + error.message, 'error');
            return showProfessionalsConfig();
        }

        if (!data) {
            showAlert('Profissional não encontrado', 'error');
            return showProfessionalsConfig();
        }

        professional = data;
    }

    configContent.innerHTML = `
        <div class="card form-card config-edit-card">
            <div class="config-form-heading">
                <span>${professional ? 'EDIÇÃO' : 'NOVO PERFIL'}</span>
                <div class="card-title">
                    ${professional ? 'Editar profissional' : 'Novo profissional'}
                </div>
            </div>

            <input
                type="hidden"
                id="professional-id"
                value="${professional?.id || ''}"
            >

            <div class="form-group">
                <label>Nome</label>
                <input
                    type="text"
                    id="professional-name"
                    maxlength="120"
                    autocomplete="off"
                    placeholder="Nome do profissional"
                    value="${escapeConfigAttribute(professional?.display_name || '')}"
                >
            </div>

            ${professional?.auth_user_id ? `
                <div class="config-linked-note">
                    <span>ACESSO VINCULADO</span>
                    <p>
                        Este perfil já possui uma conta de autenticação associada.
                        A edição abaixo não altera login nem permissões.
                    </p>
                </div>
            ` : ''}

            <label class="config-toggle-row">
                <input
                    type="checkbox"
                    id="professional-active"
                    ${professional ? (professional.active ? 'checked' : '') : 'checked'}
                >
                <span>
                    <strong>Profissional ativo</strong>
                    <small>
                        Desativar remove o perfil das novas reservas
                        sem apagar o histórico.
                    </small>
                </span>
            </label>

            <div class="button-group">
                <button
                    class="button button-primary"
                    id="professional-save-submit"
                    data-kira-action="submitProfessionalForm()"
                >
                    ${professional ? 'Salvar alterações' : 'Criar profissional'}
                </button>

                <button
                    class="button button-secondary"
                    data-kira-action="showProfessionalsConfig()"
                >
                    Cancelar
                </button>
            </div>
        </div>
    `;
}

function showAddProfessionalForm() {
    return showProfessionalForm();
}

async function submitProfessionalForm() {
    const professionalId =
        document.getElementById('professional-id')?.value || null;

    const requestKey = `professional:${professionalId || 'new'}`;
    const button = document.getElementById('professional-save-submit');

    if (configurationMutationRequests.has(requestKey)) return;

    try {
        const name =
            document.getElementById('professional-name').value.trim();

        const active =
            document.getElementById('professional-active').checked;

        const orgId =
            appState.workspaceData?.organization?.id;

        if (!name || name.length < 2) {
            showAlert('Digite o nome do profissional', 'error');
            return;
        }

        let duplicateQuery = appState.supabaseClient
            .from('professionals')
            .select('id')
            .eq('organization_id', orgId)
            .ilike('display_name', name)
            .limit(1);

        if (professionalId) {
            duplicateQuery =
                duplicateQuery.neq('id', professionalId);
        }

        const { data: duplicate, error: duplicateError } =
            await duplicateQuery.maybeSingle();

        if (duplicateError) throw duplicateError;

        if (duplicate) {
            showAlert(
                'Já existe um profissional com esse nome',
                'error'
            );
            return;
        }

        configurationMutationRequests.add(requestKey);
        setConfigButtonBusy(
            button,
            true,
            professionalId ? 'Salvando...' : 'Criando...'
        );

        let result;

        if (professionalId) {
            result = await appState.supabaseClient
                .from('professionals')
                .update({
                    display_name: name,
                    active
                })
                .eq('organization_id', orgId)
                .eq('id', professionalId);
        } else {
            result = await appState.supabaseClient
                .from('professionals')
                .insert([{
                    organization_id: orgId,
                    display_name: name,
                    active
                }]);
        }

        if (result.error) throw result.error;

        await refreshConfigurationWorkspace();

        showAlert(
            professionalId
                ? 'Profissional atualizado com sucesso'
                : 'Profissional criado com sucesso',
            'success'
        );

        await showProfessionalsConfig();
    } catch (error) {
        console.error('Save professional error:', error);
        showAlert(
            'Erro ao salvar profissional: ' + error.message,
            'error'
        );
    } finally {
        configurationMutationRequests.delete(requestKey);

        if (button && document.body.contains(button)) {
            setConfigButtonBusy(button, false);
        }
    }
}

async function deleteProfessionalConfig(professionalId) {
    if (appState.userRole !== 'OWNER') {
        showAlert('Somente o proprietário pode excluir profissionais', 'error');
        return;
    }

    const requestKey = `delete-professional:${professionalId}`;
    if (configurationMutationRequests.has(requestKey)) return;

    try {
        const orgId = appState.workspaceData?.organization?.id;

        const { data: professional, error: loadError } =
            await appState.supabaseClient
                .from('professionals')
                .select('id,display_name,active,auth_user_id')
                .eq('organization_id', orgId)
                .eq('id', professionalId)
                .maybeSingle();

        if (loadError) throw loadError;

        if (!professional) {
            showAlert('Profissional não encontrado', 'error');
            return;
        }

        const confirmed = window.confirm(
            `Tem certeza que deseja excluir "${professional.display_name}"?`
        );

        if (!confirmed) return;

        configurationMutationRequests.add(requestKey);

        const { error } = await appState.supabaseClient
            .from('professionals')
            .update({ active: false })
            .eq('organization_id', orgId)
            .eq('id', professionalId);

        if (error) throw error;

        await refreshConfigurationWorkspace();
        showAlert('Profissional excluído com sucesso', 'success');
        await showProfessionalsConfig();
    } catch (error) {
        console.error('Delete professional error:', error);
        showAlert('Erro ao excluir profissional: ' + error.message, 'error');
    } finally {
        configurationMutationRequests.delete(requestKey);
    }
}

async function restoreProfessionalConfig(professionalId) {
    if (appState.userRole !== 'OWNER') {
        showAlert('Somente o proprietário pode restaurar profissionais', 'error');
        return;
    }

    const requestKey = `restore-professional:${professionalId}`;
    if (configurationMutationRequests.has(requestKey)) return;

    try {
        const orgId = appState.workspaceData?.organization?.id;
        configurationMutationRequests.add(requestKey);

        const { error } = await appState.supabaseClient
            .from('professionals')
            .update({ active: true })
            .eq('organization_id', orgId)
            .eq('id', professionalId);

        if (error) throw error;

        await refreshConfigurationWorkspace();
        showAlert('Profissional restaurado com sucesso', 'success');
        await showProfessionalsConfig();
    } catch (error) {
        console.error('Restore professional error:', error);
        showAlert('Erro ao restaurar profissional: ' + error.message, 'error');
    } finally {
        configurationMutationRequests.delete(requestKey);
    }
}

// Compatibilidade com versões anteriores.
async function submitAddProfessional() {
    return submitProfessionalForm();
}

// KIRA_CONFIG_LINKS_HOURS_V19
async function showProfessionalServicesConfig() {
    const configContent = document.getElementById('config-content');
    const orgId = appState.workspaceData?.organization?.id;

    configContent.innerHTML = `
        <div class="card">
            <div class="ops-loading">
                <div class="loading"></div>
                <span>Carregando vínculos...</span>
            </div>
        </div>
    `;

    try {
        const [
            { data: professionals, error: profError },
            { data: services, error: servError },
            { data: links, error: linkError }
        ] = await Promise.all([
            appState.supabaseClient
                .from('professionals')
                .select('id,display_name,active')
                .eq('organization_id', orgId)
                .eq('active', true)
                .order('display_name'),

            appState.supabaseClient
                .from('services')
                .select('id,name,active')
                .eq('organization_id', orgId)
                .eq('active', true)
                .order('name'),

            appState.supabaseClient
                .from('professional_services')
                .select('professional_id,service_id')
                .eq('organization_id', orgId)
        ]);

        if (profError) throw profError;
        if (servError) throw servError;
        if (linkError) throw linkError;

        const activeProfessionalIds = new Set(
            (professionals || []).map(p => p.id)
        );

        const activeServiceIds = new Set(
            (services || []).map(s => s.id)
        );

        const activeLinks = (links || []).filter(link =>
            activeProfessionalIds.has(link.professional_id) &&
            activeServiceIds.has(link.service_id)
        );

        const linksByProfessional = {};

        for (const link of activeLinks) {
            if (!linksByProfessional[link.professional_id]) {
                linksByProfessional[link.professional_id] = new Set();
            }

            linksByProfessional[link.professional_id].add(link.service_id);
        }

        configContent.innerHTML = `
            <div class="card config-list-card">
                <div class="config-list-head">
                    <div>
                        <span>VÍNCULOS</span>
                        <div class="card-title">Profissional × serviço</div>
                        <p>
                            Defina exatamente quais serviços cada profissional
                            pode receber no agendamento.
                        </p>
                    </div>
                </div>

                ${(professionals || []).length ? `
                    <div class="config-link-groups">
                        ${(professionals || []).map(professional => {
                            const serviceIds =
                                linksByProfessional[professional.id] || new Set();

                            const linkedServices =
                                (services || []).filter(service =>
                                    serviceIds.has(service.id)
                                );

                            return `
                                <section class="config-link-group">
                                    <div class="config-link-group-head">
                                        <div>
                                            <span>PROFISSIONAL</span>
                                            <strong>
                                                ${sanitizeText(professional.display_name)}
                                            </strong>
                                        </div>

                                        <button
                                            class="button button-secondary compact-action"
                                            data-kira-action="showProfessionalServiceManager('${professional.id}')"
                                        >
                                            Gerenciar serviços
                                        </button>
                                    </div>

                                    <div class="config-service-tags">
                                        ${linkedServices.length ? linkedServices.map(service => `
                                            <span>
                                                ${sanitizeText(service.name)}
                                            </span>
                                        `).join('') : `
                                            <small>Nenhum serviço vinculado</small>
                                        `}
                                    </div>
                                </section>
                            `;
                        }).join('')}
                    </div>
                ` : `
                    <div class="ops-empty">
                        <strong>Nenhum profissional ativo</strong>
                        <span>Cadastre ou restaure um profissional antes de criar vínculos.</span>
                    </div>
                `}
            </div>
        `;
    } catch (error) {
        console.error('Load professional services config error:', error);

        configContent.innerHTML = `
            <div class="alert alert-error">
                Erro ao carregar vínculos: ${sanitizeText(error.message)}
            </div>
        `;
    }
}

async function showProfessionalServiceManager(professionalId) {
    const configContent = document.getElementById('config-content');
    const orgId = appState.workspaceData?.organization?.id;

    configContent.innerHTML = `
        <div class="card">
            <div class="ops-loading">
                <div class="loading"></div>
                <span>Carregando serviços...</span>
            </div>
        </div>
    `;

    try {
        const [
            { data: professional, error: profError },
            { data: services, error: servError },
            { data: links, error: linkError }
        ] = await Promise.all([
            appState.supabaseClient
                .from('professionals')
                .select('id,display_name,active')
                .eq('organization_id', orgId)
                .eq('id', professionalId)
                .eq('active', true)
                .maybeSingle(),

            appState.supabaseClient
                .from('services')
                .select('id,name,active')
                .eq('organization_id', orgId)
                .eq('active', true)
                .order('name'),

            appState.supabaseClient
                .from('professional_services')
                .select('service_id')
                .eq('organization_id', orgId)
                .eq('professional_id', professionalId)
        ]);

        if (profError) throw profError;
        if (servError) throw servError;
        if (linkError) throw linkError;

        if (!professional) {
            showAlert('Profissional não encontrado ou inativo', 'error');
            return showProfessionalServicesConfig();
        }

        const selected = new Set((links || []).map(link => link.service_id));

        configContent.innerHTML = `
            <div class="card form-card config-edit-card">
                <div class="config-form-heading">
                    <span>VÍNCULOS</span>
                    <div class="card-title">
                        ${sanitizeText(professional.display_name)}
                    </div>
                    <p class="text-muted">
                        Marque os serviços que este profissional executa.
                    </p>
                </div>

                <div
                    id="professional-service-options"
                    class="config-service-checklist"
                    data-professional-id="${professional.id}"
                >
                    ${(services || []).map(service => `
                        <label class="config-service-option">
                            <input
                                type="checkbox"
                                value="${service.id}"
                                ${selected.has(service.id) ? 'checked' : ''}
                            >
                            <span>
                                <strong>${sanitizeText(service.name)}</strong>
                                <small>
                                    ${selected.has(service.id)
                                        ? 'Vinculado atualmente'
                                        : 'Não vinculado'}
                                </small>
                            </span>
                        </label>
                    `).join('')}
                </div>

                <div class="button-group">
                    <button
                        class="button button-primary"
                        id="professional-services-save"
                        data-kira-action="submitProfessionalServiceManager('${professional.id}')"
                    >
                        Salvar vínculos
                    </button>

                    <button
                        class="button button-secondary"
                        data-kira-action="showProfessionalServicesConfig()"
                    >
                        Cancelar
                    </button>
                </div>
            </div>
        `;
    } catch (error) {
        console.error('Load professional service manager error:', error);

        configContent.innerHTML = `
            <div class="alert alert-error">
                Erro ao carregar vínculos: ${sanitizeText(error.message)}
            </div>
        `;
    }
}

async function submitProfessionalServiceManager(professionalId) {
    const requestKey = `professional-services:${professionalId}`;
    const button = document.getElementById('professional-services-save');

    if (configurationMutationRequests.has(requestKey)) return;

    try {
        const orgId = appState.workspaceData?.organization?.id;
        const container = document.getElementById('professional-service-options');

        if (!container) {
            showAlert('Não foi possível ler os vínculos selecionados', 'error');
            return;
        }

        const selectedServiceIds = Array.from(
            container.querySelectorAll('input[type="checkbox"]:checked')
        ).map(input => input.value);

        const { data: existingLinks, error: existingError } =
            await appState.supabaseClient
                .from('professional_services')
                .select('service_id')
                .eq('organization_id', orgId)
                .eq('professional_id', professionalId);

        if (existingError) throw existingError;

        const existingIds = new Set(
            (existingLinks || []).map(link => link.service_id)
        );

        const selectedIds = new Set(selectedServiceIds);

        const toAdd = selectedServiceIds
            .filter(serviceId => !existingIds.has(serviceId));

        const toRemove = Array.from(existingIds)
            .filter(serviceId => !selectedIds.has(serviceId));

        configurationMutationRequests.add(requestKey);
        setConfigButtonBusy(button, true, 'Salvando...');

        if (toRemove.length) {
            const { error: deleteError } = await appState.supabaseClient
                .from('professional_services')
                .delete()
                .eq('organization_id', orgId)
                .eq('professional_id', professionalId)
                .in('service_id', toRemove);

            if (deleteError) throw deleteError;
        }

        if (toAdd.length) {
            const rows = toAdd.map(serviceId => ({
                organization_id: orgId,
                professional_id: professionalId,
                service_id: serviceId
            }));

            const { error: insertError } = await appState.supabaseClient
                .from('professional_services')
                .upsert(rows, {
                    onConflict: 'professional_id,service_id'
                });

            if (insertError) throw insertError;
        }

        await refreshConfigurationWorkspace();

        showAlert('Vínculos atualizados com sucesso', 'success');
        await showProfessionalServicesConfig();
    } catch (error) {
        console.error('Save professional services error:', error);
        showAlert('Erro ao salvar vínculos: ' + error.message, 'error');
    } finally {
        configurationMutationRequests.delete(requestKey);

        if (button && document.body.contains(button)) {
            setConfigButtonBusy(button, false);
        }
    }
}

// Compatibilidade com chamadas antigas.
async function showAddProfessionalServiceForm() {
    return showProfessionalServicesConfig();
}

async function submitAddProfessionalService() {
    return showProfessionalServicesConfig();
}

async function showProfessionalHoursConfig() {
    const configContent = document.getElementById('config-content');
    const orgId = appState.workspaceData?.organization?.id;

    configContent.innerHTML = `
        <div class="card">
            <div class="ops-loading">
                <div class="loading"></div>
                <span>Carregando expedientes...</span>
            </div>
        </div>
    `;

    try {
        const [
            { data: professionals, error: profError },
            { data: hours, error: hoursError }
        ] = await Promise.all([
            appState.supabaseClient
                .from('professionals')
                .select('id,display_name,active')
                .eq('organization_id', orgId)
                .eq('active', true)
                .order('display_name'),

            appState.supabaseClient
                .from('professional_hours')
                .select('professional_id,weekday,opens_at,closes_at,closed')
                .eq('organization_id', orgId)
                .order('weekday')
        ]);

        if (profError) throw profError;
        if (hoursError) throw hoursError;

        const dayNames = {
            1: 'Seg',
            2: 'Ter',
            3: 'Qua',
            4: 'Qui',
            5: 'Sex',
            6: 'Sáb',
            7: 'Dom'
        };

        const hoursMap = {};

        for (const row of (hours || [])) {
            if (!hoursMap[row.professional_id]) {
                hoursMap[row.professional_id] = {};
            }

            hoursMap[row.professional_id][row.weekday] = row;
        }

        configContent.innerHTML = `
            <div class="card config-list-card">
                <div class="config-list-head">
                    <div>
                        <span>EXPEDIENTE</span>
                        <div class="card-title">Jornada semanal</div>
                        <p>
                            Configure a disponibilidade semanal completa
                            de cada profissional em uma única tela.
                        </p>
                    </div>
                </div>

                ${(professionals || []).length ? `
                    <div class="config-hours-groups">
                        ${(professionals || []).map(professional => `
                            <section class="config-hours-group">
                                <div class="config-hours-group-head">
                                    <div>
                                        <span>PROFISSIONAL</span>
                                        <strong>
                                            ${sanitizeText(professional.display_name)}
                                        </strong>
                                    </div>

                                    <button
                                        class="button button-secondary compact-action"
                                        data-kira-action="showProfessionalHoursEditor('${professional.id}')"
                                    >
                                        Editar semana
                                    </button>
                                </div>

                                <div class="config-week-strip">
                                    ${[1,2,3,4,5,6,7].map(weekday => {
                                        const row =
                                            hoursMap[professional.id]?.[weekday];

                                        const label =
                                            !row || row.closed
                                                ? 'Fechado'
                                                : `${String(row.opens_at || '').slice(0,5)}–${String(row.closes_at || '').slice(0,5)}`;

                                        return `
                                            <div class="${!row || row.closed ? 'is-closed' : ''}">
                                                <span>${dayNames[weekday]}</span>
                                                <strong>${label}</strong>
                                            </div>
                                        `;
                                    }).join('')}
                                </div>
                            </section>
                        `).join('')}
                    </div>
                ` : `
                    <div class="ops-empty">
                        <strong>Nenhum profissional ativo</strong>
                        <span>Cadastre ou restaure um profissional para configurar o expediente.</span>
                    </div>
                `}
            </div>
        `;
    } catch (error) {
        console.error('Load professional hours config error:', error);

        configContent.innerHTML = `
            <div class="alert alert-error">
                Erro ao carregar expedientes: ${sanitizeText(error.message)}
            </div>
        `;
    }
}

async function showProfessionalHoursEditor(professionalId) {
    const configContent = document.getElementById('config-content');
    const orgId = appState.workspaceData?.organization?.id;

    configContent.innerHTML = `
        <div class="card">
            <div class="ops-loading">
                <div class="loading"></div>
                <span>Carregando semana...</span>
            </div>
        </div>
    `;

    try {
        const [
            { data: professional, error: profError },
            { data: hours, error: hoursError }
        ] = await Promise.all([
            appState.supabaseClient
                .from('professionals')
                .select('id,display_name,active')
                .eq('organization_id', orgId)
                .eq('id', professionalId)
                .eq('active', true)
                .maybeSingle(),

            appState.supabaseClient
                .from('professional_hours')
                .select('weekday,opens_at,closes_at,closed')
                .eq('organization_id', orgId)
                .eq('professional_id', professionalId)
        ]);

        if (profError) throw profError;
        if (hoursError) throw hoursError;

        if (!professional) {
            showAlert('Profissional não encontrado ou inativo', 'error');
            return showProfessionalHoursConfig();
        }

        const existing = Object.fromEntries(
            (hours || []).map(row => [row.weekday, row])
        );

        const weekdays = [
            { id: 1, name: 'Segunda-feira' },
            { id: 2, name: 'Terça-feira' },
            { id: 3, name: 'Quarta-feira' },
            { id: 4, name: 'Quinta-feira' },
            { id: 5, name: 'Sexta-feira' },
            { id: 6, name: 'Sábado' },
            { id: 7, name: 'Domingo' }
        ];

        configContent.innerHTML = `
            <div class="card form-card config-edit-card">
                <div class="config-form-heading">
                    <span>EXPEDIENTE</span>
                    <div class="card-title">
                        ${sanitizeText(professional.display_name)}
                    </div>
                    <p class="text-muted">
                        Configure abertura, fechamento ou marque o dia como fechado.
                    </p>
                </div>

                <div
                    id="professional-hours-week"
                    class="config-hours-editor"
                    data-professional-id="${professional.id}"
                >
                    ${weekdays.map(day => {
                        const row = existing[day.id] || null;
                        const closed = row ? Boolean(row.closed) : true;

                        return `
                            <div class="config-hours-row" data-weekday="${day.id}">
                                <div class="config-hours-day">
                                    <strong>${day.name}</strong>

                                    <label>
                                        <input
                                            type="checkbox"
                                            class="hours-closed-toggle"
                                            ${closed ? 'checked' : ''}
                                            onchange="syncProfessionalHoursRow(this)"
                                        >
                                        Fechado
                                    </label>
                                </div>

                                <div class="config-hours-times">
                                    <div class="form-group">
                                        <label>Abertura</label>
                                        <input
                                            type="time"
                                            class="hours-opens-input"
                                            value="${closed ? '' : String(row?.opens_at || '').slice(0,5)}"
                                            ${closed ? 'disabled' : ''}
                                        >
                                    </div>

                                    <div class="form-group">
                                        <label>Fechamento</label>
                                        <input
                                            type="time"
                                            class="hours-closes-input"
                                            value="${closed ? '' : String(row?.closes_at || '').slice(0,5)}"
                                            ${closed ? 'disabled' : ''}
                                        >
                                    </div>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>

                <div class="button-group">
                    <button
                        class="button button-primary"
                        id="professional-hours-save"
                        data-kira-action="submitProfessionalHoursWeek('${professional.id}')"
                    >
                        Salvar semana
                    </button>

                    <button
                        class="button button-secondary"
                        data-kira-action="showProfessionalHoursConfig()"
                    >
                        Cancelar
                    </button>
                </div>
            </div>
        `;
    } catch (error) {
        console.error('Load professional hours editor error:', error);

        configContent.innerHTML = `
            <div class="alert alert-error">
                Erro ao carregar expediente: ${sanitizeText(error.message)}
            </div>
        `;
    }
}

function syncProfessionalHoursRow(toggle) {
    const row = toggle.closest('.config-hours-row');

    if (!row) return;

    const opens = row.querySelector('.hours-opens-input');
    const closes = row.querySelector('.hours-closes-input');
    const closed = toggle.checked;

    opens.disabled = closed;
    closes.disabled = closed;

    if (closed) {
        opens.value = '';
        closes.value = '';
    }
}

async function submitProfessionalHoursWeek(professionalId) {
    const requestKey = `professional-hours:${professionalId}`;
    const button = document.getElementById('professional-hours-save');

    if (configurationMutationRequests.has(requestKey)) return;

    try {
        const orgId = appState.workspaceData?.organization?.id;
        const week = document.getElementById('professional-hours-week');

        if (!week) {
            showAlert('Não foi possível ler o expediente', 'error');
            return;
        }

        const rows = Array.from(
            week.querySelectorAll('.config-hours-row')
        );

        const payload = [];

        for (const row of rows) {
            const weekday = Number(row.dataset.weekday);
            const closed =
                row.querySelector('.hours-closed-toggle').checked;

            const opensAt =
                row.querySelector('.hours-opens-input').value;

            const closesAt =
                row.querySelector('.hours-closes-input').value;

            if (!closed) {
                if (!opensAt || !closesAt) {
                    showAlert(
                        `Preencha abertura e fechamento do dia ${weekday}`,
                        'error'
                    );
                    return;
                }

                if (closesAt <= opensAt) {
                    showAlert(
                        'O horário de fechamento deve ser maior que o de abertura',
                        'error'
                    );
                    return;
                }
            }

            payload.push({
                organization_id: orgId,
                professional_id: professionalId,
                weekday,
                opens_at: closed ? null : opensAt,
                closes_at: closed ? null : closesAt,
                closed
            });
        }

        configurationMutationRequests.add(requestKey);
        setConfigButtonBusy(button, true, 'Salvando...');

        const { error } = await appState.supabaseClient
            .from('professional_hours')
            .upsert(payload, {
                onConflict: 'professional_id,weekday'
            });

        if (error) throw error;

        await refreshConfigurationWorkspace();

        showAlert('Expediente semanal atualizado', 'success');
        await showProfessionalHoursConfig();
    } catch (error) {
        console.error('Save professional hours error:', error);
        showAlert('Erro ao salvar expediente: ' + error.message, 'error');
    } finally {
        configurationMutationRequests.delete(requestKey);

        if (button && document.body.contains(button)) {
            setConfigButtonBusy(button, false);
        }
    }
}

// Compatibilidade com chamadas antigas.
async function showAddProfessionalHoursForm() {
    return showProfessionalHoursConfig();
}

async function submitAddProfessionalHours() {
    return showProfessionalHoursConfig();
}

// KIRA_CONFIG_COMMISSION_BOOKING_V20
async function showCommissionRulesConfig() {
    if (appState.userRole !== 'OWNER') {
        showAlert('Acesso negado', 'error');
        return;
    }

    const configContent = document.getElementById('config-content');
    const orgId = appState.workspaceData?.organization?.id;

    configContent.innerHTML = `
        <div class="card">
            <div class="ops-loading">
                <div class="loading"></div>
                <span>Carregando comissões...</span>
            </div>
        </div>
    `;

    try {
        const [
            { data: professionals, error: profError },
            { data: rules, error: rulesError }
        ] = await Promise.all([
            appState.supabaseClient
                .from('professionals')
                .select('id,display_name,active')
                .eq('organization_id', orgId)
                .eq('active', true)
                .order('display_name'),

            appState.supabaseClient
                .from('professional_commission_rules')
                .select('professional_id,rate_bps,basis,active')
                .eq('organization_id', orgId)
        ]);

        if (profError) throw profError;
        if (rulesError) throw rulesError;

        const ruleMap = Object.fromEntries(
            (rules || []).map(rule => [rule.professional_id, rule])
        );

        configContent.innerHTML = `
            <div class="card config-list-card">
                <div class="config-list-head">
                    <div>
                        <span>COMISSIONAMENTO</span>
                        <div class="card-title">Regras por profissional</div>
                        <p>
                            Configure percentual, base de cálculo e status
                            individualmente para cada profissional ativo.
                        </p>
                    </div>
                </div>

                ${(professionals || []).length ? `
                    <div class="config-commission-groups">
                        ${(professionals || []).map(professional => {
                            const rule = ruleMap[professional.id] || null;
                            const rate = rule
                                ? (Number(rule.rate_bps || 0) / 100).toFixed(2)
                                : '0.00';

                            const basisLabel =
                                rule?.basis === 'SERVICE_TOTAL'
                                    ? 'Total do serviço'
                                    : 'Valor recebido';

                            return `
                                <section class="config-commission-row">
                                    <div class="config-commission-person">
                                        <span>PROFISSIONAL</span>
                                        <strong>${sanitizeText(professional.display_name)}</strong>
                                    </div>

                                    <div class="config-commission-value">
                                        <span>TAXA</span>
                                        <strong>${rate}%</strong>
                                    </div>

                                    <div class="config-commission-value">
                                        <span>BASE</span>
                                        <strong>${sanitizeText(basisLabel)}</strong>
                                    </div>

                                    <div>
                                        <span class="config-status ${rule?.active ? 'is-active' : 'is-inactive'}">
                                            ${rule?.active ? 'ATIVA' : 'INATIVA'}
                                        </span>
                                    </div>

                                    <div class="config-row-actions">
                                        <button
                                            class="button button-secondary compact-action"
                                            data-kira-action="showCommissionRuleForm('${professional.id}')"
                                        >
                                            ${rule ? 'Editar' : 'Configurar'}
                                        </button>
                                    </div>
                                </section>
                            `;
                        }).join('')}
                    </div>
                ` : `
                    <div class="ops-empty">
                        <strong>Nenhum profissional ativo</strong>
                        <span>Cadastre ou restaure um profissional para configurar comissões.</span>
                    </div>
                `}

                <div class="config-info-note">
                    <strong>Base de cálculo</strong>
                    <span>
                        “Valor recebido” calcula sobre o que efetivamente entrou.
                        “Total do serviço” calcula sobre o valor integral do serviço.
                    </span>
                </div>
            </div>
        `;
    } catch (error) {
        console.error('Load commission rules config error:', error);

        configContent.innerHTML = `
            <div class="alert alert-error">
                Erro ao carregar comissões: ${sanitizeText(error.message)}
            </div>
        `;
    }
}

async function showCommissionRuleForm(professionalId) {
    if (appState.userRole !== 'OWNER') {
        showAlert('Acesso negado', 'error');
        return;
    }

    const configContent = document.getElementById('config-content');
    const orgId = appState.workspaceData?.organization?.id;

    configContent.innerHTML = `
        <div class="card">
            <div class="ops-loading">
                <div class="loading"></div>
                <span>Carregando regra...</span>
            </div>
        </div>
    `;

    try {
        const [
            { data: professional, error: profError },
            { data: rule, error: ruleError }
        ] = await Promise.all([
            appState.supabaseClient
                .from('professionals')
                .select('id,display_name,active')
                .eq('organization_id', orgId)
                .eq('id', professionalId)
                .eq('active', true)
                .maybeSingle(),

            appState.supabaseClient
                .from('professional_commission_rules')
                .select('professional_id,rate_bps,basis,active')
                .eq('organization_id', orgId)
                .eq('professional_id', professionalId)
                .maybeSingle()
        ]);

        if (profError) throw profError;
        if (ruleError) throw ruleError;

        if (!professional) {
            showAlert('Profissional não encontrado ou inativo', 'error');
            return showCommissionRulesConfig();
        }

        const rate = rule
            ? (Number(rule.rate_bps || 0) / 100).toFixed(2)
            : '50.00';

        configContent.innerHTML = `
            <div class="card form-card config-edit-card">
                <div class="config-form-heading">
                    <span>COMISSÃO</span>
                    <div class="card-title">
                        ${sanitizeText(professional.display_name)}
                    </div>
                    <p class="text-muted">
                        A alteração vale para novos cálculos. Registros financeiros
                        já lançados permanecem preservados.
                    </p>
                </div>

                <div class="form-group">
                    <label>Taxa (%)</label>
                    <input
                        type="number"
                        id="commission-rate"
                        step="0.01"
                        min="0"
                        max="100"
                        value="${rate}"
                    >
                </div>

                <div class="form-group">
                    <label>Base de cálculo</label>
                    <select id="commission-basis">
                        <option
                            value="RECEIVED"
                            ${!rule || rule.basis === 'RECEIVED' ? 'selected' : ''}
                        >
                            Valor recebido
                        </option>

                        <option
                            value="SERVICE_TOTAL"
                            ${rule?.basis === 'SERVICE_TOTAL' ? 'selected' : ''}
                        >
                            Total do serviço
                        </option>
                    </select>
                </div>

                <label class="config-toggle-row">
                    <input
                        type="checkbox"
                        id="commission-active"
                        ${!rule || rule.active ? 'checked' : ''}
                    >
                    <span>
                        <strong>Regra ativa</strong>
                        <small>
                            Se desativada, novos cálculos deixam de gerar comissão
                            para este profissional.
                        </small>
                    </span>
                </label>

                <div class="button-group">
                    <button
                        class="button button-primary"
                        id="commission-save-submit"
                        data-kira-action="submitCommissionRule('${professional.id}')"
                    >
                        Salvar regra
                    </button>

                    <button
                        class="button button-secondary"
                        data-kira-action="showCommissionRulesConfig()"
                    >
                        Cancelar
                    </button>
                </div>
            </div>
        `;
    } catch (error) {
        console.error('Load commission rule form error:', error);

        configContent.innerHTML = `
            <div class="alert alert-error">
                Erro ao carregar regra: ${sanitizeText(error.message)}
            </div>
        `;
    }
}

async function submitCommissionRule(professionalId) {
    if (appState.userRole !== 'OWNER') {
        showAlert('Acesso negado', 'error');
        return;
    }

    const requestKey = `commission-rule:${professionalId}`;
    const button = document.getElementById('commission-save-submit');

    if (configurationMutationRequests.has(requestKey)) return;

    try {
        const ratePercent =
            Number(document.getElementById('commission-rate').value);

        const basis =
            document.getElementById('commission-basis').value;

        const active =
            document.getElementById('commission-active').checked;

        const orgId =
            appState.workspaceData?.organization?.id;

        if (
            !Number.isFinite(ratePercent) ||
            ratePercent < 0 ||
            ratePercent > 100
        ) {
            showAlert('A taxa deve ficar entre 0% e 100%', 'error');
            return;
        }

        if (!['RECEIVED', 'SERVICE_TOTAL'].includes(basis)) {
            showAlert('Selecione uma base de cálculo válida', 'error');
            return;
        }

        configurationMutationRequests.add(requestKey);
        setConfigButtonBusy(button, true, 'Salvando...');

        const { error } = await appState.supabaseClient
            .from('professional_commission_rules')
            .upsert([{
                organization_id: orgId,
                professional_id: professionalId,
                rate_bps: Math.round(ratePercent * 100),
                basis,
                active
            }], {
                onConflict: 'professional_id'
            });

        if (error) throw error;

        await refreshConfigurationWorkspace();

        showAlert('Regra de comissão atualizada', 'success');
        await showCommissionRulesConfig();
    } catch (error) {
        console.error('Save commission rule error:', error);
        showAlert('Erro ao salvar regra: ' + error.message, 'error');
    } finally {
        configurationMutationRequests.delete(requestKey);

        if (button && document.body.contains(button)) {
            setConfigButtonBusy(button, false);
        }
    }
}

// Compatibilidade com chamadas anteriores.
async function showAddCommissionRuleForm() {
    return showCommissionRulesConfig();
}

async function submitAddCommissionRule() {
    return showCommissionRulesConfig();
}

async function loadBookingReadiness(orgId) {
    const [
        { count: serviceCount, error: serviceError },
        { data: professionals, error: profError },
        { data: links, error: linkError },
        { data: hours, error: hoursError }
    ] = await Promise.all([
        appState.supabaseClient
            .from('services')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', orgId)
            .eq('active', true),

        appState.supabaseClient
            .from('professionals')
            .select('id')
            .eq('organization_id', orgId)
            .eq('active', true),

        appState.supabaseClient
            .from('professional_services')
            .select('professional_id,service_id')
            .eq('organization_id', orgId),

        appState.supabaseClient
            .from('professional_hours')
            .select('professional_id,closed')
            .eq('organization_id', orgId)
            .eq('closed', false)
    ]);

    if (serviceError) throw serviceError;
    if (profError) throw profError;
    if (linkError) throw linkError;
    if (hoursError) throw hoursError;

    const professionalIds = new Set(
        (professionals || []).map(p => p.id)
    );

    const linkedProfessionals = new Set(
        (links || [])
            .filter(link => professionalIds.has(link.professional_id))
            .map(link => link.professional_id)
    );

    const professionalsWithHours = new Set(
        (hours || [])
            .filter(row => professionalIds.has(row.professional_id))
            .map(row => row.professional_id)
    );

    const activeProfessionals = professionalIds.size;

    return {
        activeServices: Number(serviceCount || 0),
        activeProfessionals,
        linkedProfessionals: linkedProfessionals.size,
        professionalsWithHours: professionalsWithHours.size,
        ready:
            Number(serviceCount || 0) > 0 &&
            activeProfessionals > 0 &&
            linkedProfessionals.size === activeProfessionals &&
            professionalsWithHours.size === activeProfessionals
    };
}

async function showBookingPoliciesConfig() {
    if (appState.userRole !== 'OWNER') {
        showAlert('Acesso negado', 'error');
        return;
    }

    const configContent = document.getElementById('config-content');
    const orgId = appState.workspaceData?.organization?.id;

    configContent.innerHTML = `
        <div class="card">
            <div class="ops-loading">
                <div class="loading"></div>
                <span>Carregando política...</span>
            </div>
        </div>
    `;

    try {
        const [
            { data: policy, error: policyError },
            readiness
        ] = await Promise.all([
            appState.supabaseClient
                .from('booking_policies')
                .select(
                    'public_booking_enabled,allow_public_cancel,' +
                    'allow_public_reschedule,min_notice_minutes,max_advance_days'
                )
                .eq('organization_id', orgId)
                .maybeSingle(),

            loadBookingReadiness(orgId)
        ]);

        if (policyError && policyError.code !== 'PGRST116') {
            throw policyError;
        }

        const p = policy || {
            public_booking_enabled: false,
            allow_public_cancel: false,
            allow_public_reschedule: false,
            min_notice_minutes: 0,
            max_advance_days: 90
        };

        const publicStatus = p.public_booking_enabled
            ? 'AGENDAMENTO PÚBLICO ATIVO'
            : 'AGENDAMENTO PÚBLICO DESATIVADO';

        configContent.innerHTML = `
            <div class="card form-card config-edit-card booking-policy-card">
                <div class="config-booking-head">
                    <div>
                        <span>CANAL PÚBLICO</span>
                        <div class="card-title">Política de agendamento</div>
                        <p>
                            Controle quando clientes podem reservar, cancelar
                            ou reagendar pela experiência pública.
                        </p>
                    </div>

                    <span class="config-booking-state ${p.public_booking_enabled ? 'is-live' : 'is-off'}">
                        ${publicStatus}
                    </span>
                </div>

                <div class="config-readiness-grid">
                    <div>
                        <span>SERVIÇOS ATIVOS</span>
                        <strong>${readiness.activeServices}</strong>
                    </div>

                    <div>
                        <span>PROFISSIONAIS ATIVOS</span>
                        <strong>${readiness.activeProfessionals}</strong>
                    </div>

                    <div>
                        <span>COM VÍNCULOS</span>
                        <strong>
                            ${readiness.linkedProfessionals}/${readiness.activeProfessionals}
                        </strong>
                    </div>

                    <div>
                        <span>COM EXPEDIENTE</span>
                        <strong>
                            ${readiness.professionalsWithHours}/${readiness.activeProfessionals}
                        </strong>
                    </div>
                </div>

                <div class="config-readiness-note ${readiness.ready ? 'is-ready' : 'is-blocked'}">
                    <strong>
                        ${readiness.ready
                            ? 'Estrutura pronta para receber reservas.'
                            : 'Estrutura incompleta para ativação pública.'}
                    </strong>

                    <span>
                        ${readiness.ready
                            ? 'Revise as regras abaixo antes de publicar o agendamento.'
                            : 'Todos os profissionais ativos precisam ter vínculo de serviço e pelo menos um dia de expediente aberto.'}
                    </span>
                </div>

                <label class="config-toggle-row">
                    <input
                        type="checkbox"
                        id="policy-booking-enabled"
                        ${p.public_booking_enabled ? 'checked' : ''}
                        ${!readiness.ready && !p.public_booking_enabled ? 'disabled' : ''}
                    >
                    <span>
                        <strong>Habilitar agendamento público</strong>
                        <small>
                            Quando ativo, clientes reais passam a conseguir criar reservas.
                        </small>
                    </span>
                </label>

                <div class="config-form-grid">
                    <div class="form-group">
                        <label>Aviso prévio mínimo (minutos)</label>
                        <input
                            type="number"
                            id="policy-min-notice"
                            min="0"
                            max="10080"
                            step="1"
                            value="${Number(p.min_notice_minutes ?? 0)}"
                        >
                    </div>

                    <div class="form-group">
                        <label>Antecedência máxima (dias)</label>
                        <input
                            type="number"
                            id="policy-max-advance"
                            min="1"
                            max="365"
                            step="1"
                            value="${Number(p.max_advance_days ?? 90)}"
                        >
                    </div>
                </div>

                <label class="config-toggle-row">
                    <input
                        type="checkbox"
                        id="policy-allow-cancel"
                        ${p.allow_public_cancel ? 'checked' : ''}
                    >
                    <span>
                        <strong>Permitir cancelamento pelo cliente</strong>
                        <small>
                            Usa o link seguro de gerenciamento criado junto com a reserva.
                        </small>
                    </span>
                </label>

                <label class="config-toggle-row">
                    <input
                        type="checkbox"
                        id="policy-allow-reschedule"
                        ${p.allow_public_reschedule ? 'checked' : ''}
                    >
                    <span>
                        <strong>Permitir reagendamento pelo cliente</strong>
                        <small>
                            O novo horário continua sujeito à disponibilidade e às regras da unidade.
                        </small>
                    </span>
                </label>

                <div class="button-group">
                    <button
                        class="button button-primary"
                        id="booking-policy-save"
                        data-kira-action="submitBookingPolicy()"
                    >
                        Salvar política
                    </button>

                    <button
                        class="button button-secondary"
                        data-kira-action="renderConfigurationPage()"
                    >
                        Cancelar
                    </button>
                </div>
            </div>
        `;
    } catch (error) {
        console.error('Load booking policy error:', error);

        configContent.innerHTML = `
            <div class="alert alert-error">
                Erro ao carregar política: ${sanitizeText(error.message)}
            </div>
        `;
    }
}

async function submitBookingPolicy() {
    if (appState.userRole !== 'OWNER') {
        showAlert('Acesso negado', 'error');
        return;
    }

    const requestKey = 'booking-policy';
    const button = document.getElementById('booking-policy-save');

    if (configurationMutationRequests.has(requestKey)) return;

    try {
        const publicBookingEnabled =
            document.getElementById('policy-booking-enabled').checked;

        const minNotice =
            Number(document.getElementById('policy-min-notice').value);

        const maxAdvance =
            Number(document.getElementById('policy-max-advance').value);

        const allowCancel =
            document.getElementById('policy-allow-cancel').checked;

        const allowReschedule =
            document.getElementById('policy-allow-reschedule').checked;

        const orgId =
            appState.workspaceData?.organization?.id;

        if (
            !Number.isInteger(minNotice) ||
            minNotice < 0 ||
            minNotice > 10080
        ) {
            showAlert(
                'O aviso prévio deve ficar entre 0 e 10080 minutos',
                'error'
            );
            return;
        }

        if (
            !Number.isInteger(maxAdvance) ||
            maxAdvance < 1 ||
            maxAdvance > 365
        ) {
            showAlert(
                'A antecedência máxima deve ficar entre 1 e 365 dias',
                'error'
            );
            return;
        }

        const readiness = await loadBookingReadiness(orgId);

        if (publicBookingEnabled && !readiness.ready) {
            showAlert(
                'Não é possível ativar: revise vínculos e expediente dos profissionais ativos.',
                'error'
            );
            return;
        }

        const currentEnabled =
            Boolean(appState.workspaceData?.booking_policy?.public_booking_enabled);

        if (publicBookingEnabled && !currentEnabled) {
            const confirmed = window.confirm(
                'Tem certeza que deseja ativar o agendamento público? ' +
                'Clientes reais poderão criar reservas.'
            );

            if (!confirmed) return;
        }

        configurationMutationRequests.add(requestKey);
        setConfigButtonBusy(button, true, 'Salvando...');

        const { error } = await appState.supabaseClient
            .from('booking_policies')
            .upsert([{
                organization_id: orgId,
                public_booking_enabled: publicBookingEnabled,
                min_notice_minutes: minNotice,
                max_advance_days: maxAdvance,
                allow_public_cancel: allowCancel,
                allow_public_reschedule: allowReschedule
            }], {
                onConflict: 'organization_id'
            });

        if (error) throw error;

        await refreshConfigurationWorkspace();

        // Mantém a política disponível localmente para o próximo toggle/edição.
        if (!appState.workspaceData.booking_policy) {
            appState.workspaceData.booking_policy = {};
        }

        Object.assign(appState.workspaceData.booking_policy, {
            public_booking_enabled: publicBookingEnabled,
            min_notice_minutes: minNotice,
            max_advance_days: maxAdvance,
            allow_public_cancel: allowCancel,
            allow_public_reschedule: allowReschedule
        });

        showAlert('Política de agendamento atualizada', 'success');
        await showBookingPoliciesConfig();
    } catch (error) {
        console.error('Update booking policy error:', error);
        showAlert('Erro ao atualizar política: ' + error.message, 'error');
    } finally {
        configurationMutationRequests.delete(requestKey);

        if (button && document.body.contains(button)) {
            setConfigButtonBusy(button, false);
        }
    }
}

// ============================================================
// UI Helpers
// ============================================================

function updateTopbar(title, status) {
    document.querySelector('.topbar-title').textContent = title;
    document.querySelector('.topbar-status').textContent = status;
}

function showAlert(message, type = 'info') {
    const alerts = document.getElementById('alerts-container') || createAlertsContainer();
    const alert = document.createElement('div');
    alert.className = `alert alert-${type}`;
    alert.textContent = sanitizeText(message);
    alerts.appendChild(alert);
    
    setTimeout(() => alert.remove(), 5000);
}

function showMessage(message, type = 'info') {
    const msgDiv = document.getElementById('auth-message');
    if (msgDiv) {
        msgDiv.className = `alert alert-${type}`;
        msgDiv.textContent = sanitizeText(message);
    }
}

function createAlertsContainer() {
    const container = document.createElement('div');
    container.id = 'alerts-container';
    container.style.cssText = 'position: fixed; top: 1rem; right: 1rem; z-index: 10000; max-width: 400px;';
    document.body.appendChild(container);
    return container;
}

function closeMobileMenu() {
    document.querySelector('.sidebar').classList.remove('mobile-open');
}

// ============================================================
// Utilities
// ============================================================

function getTodayDate() {
    return new Date().toISOString().split('T')[0];
}

function sanitizeText(text) {
    if (typeof text !== 'string') return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Load Supabase JS from CDN
function loadSupabaseLibrary() {
    return new Promise((resolve, reject) => {
        if (window.supabase) {
            resolve();
            return;
        }

        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2';
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

// Initialize Supabase library on page load
window.addEventListener('load', () => {
    loadSupabaseLibrary().catch(err => {
        console.error('Failed to load Supabase library:', err);
        showAlert('Erro ao carregar dependências', 'error');
    });
});

function setupSecureMobileSidebar() {
    const menuButton = document.getElementById('mobile-menu-toggle');
    const sidebar = document.getElementById('sidebar');

    if (!menuButton || !sidebar) return;

    const setMenuState = (open) => {
        sidebar.classList.toggle('sidebar-open', open);
        document.body.classList.toggle('sidebar-menu-open', open);

        menuButton.setAttribute('aria-expanded', open ? 'true' : 'false');
        menuButton.setAttribute(
            'aria-label',
            open ? 'Fechar menu de navegação' : 'Abrir menu de navegação'
        );
    };

    menuButton.addEventListener('click', () => {
        setMenuState(!sidebar.classList.contains('sidebar-open'));
    });

    sidebar.querySelectorAll('.nav-item').forEach((link) => {
        link.addEventListener('click', () => {
            if (window.innerWidth <= 768) {
                setMenuState(false);
            }
        });
    });

    document.addEventListener('keydown', (event) => {
        if (
            event.key === 'Escape' &&
            sidebar.classList.contains('sidebar-open')
        ) {
            setMenuState(false);
            menuButton.focus();
        }
    });

    window.addEventListener('resize', () => {
        if (window.innerWidth > 768) {
            setMenuState(false);
        }
    });
}

document.addEventListener('DOMContentLoaded', setupSecureMobileSidebar);

// KIRA_RUNTIME_ACTIONS_PERF_V24
const KIRA_ACTION_HANDLERS = Object.freeze({
    cancelPublicBooking,
    deleteProfessionalConfig,
    deleteServiceConfig,
    forgetBookingThisDevice,
    navigateTo,
    openCashAdjustmentDialog,
    openCashDialog,
    openCheckoutDialog,
    openCloseCashDialog,
    openCommissionPayoutDialog,
    openRefundDialog,
    renderConfigurationPage,
    restoreProfessionalConfig,
    showBookingPoliciesConfig,
    showCommissionRuleForm,
    showCommissionRulesConfig,
    showPasswordResetRequestForm,
    showProfessionalForm,
    showProfessionalHoursConfig,
    showProfessionalHoursEditor,
    showProfessionalServiceManager,
    showProfessionalServicesConfig,
    showProfessionalsConfig,
    showRescheduleForm,
    showServiceForm,
    showServicesConfig,
    submitBookingPolicy,
    submitCashAdjustment,
    submitCheckout,
    submitCloseCash,
    submitCommissionPayout,
    submitCommissionRule,
    submitOpenCash,
    submitProfessionalForm,
    submitProfessionalHoursWeek,
    submitProfessionalServiceManager,
    submitRefund,
    submitReschedule,
    submitServiceForm,
    updateAppointmentStatus
});

function decodeKiraActionString(value) {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = value;
    return textarea.value;
}

function parseKiraActionArgs(source, element) {
    const text = String(source || '').trim();

    if (!text) return [];

    const parts = [];
    let current = '';
    let quote = null;
    let escaped = false;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];

        if (escaped) {
            current += char;
            escaped = false;
            continue;
        }

        if (char === '\\') {
            current += char;
            escaped = true;
            continue;
        }

        if (quote) {
            current += char;

            if (char === quote) {
                quote = null;
            }

            continue;
        }

        if (char === "'" || char === '"') {
            quote = char;
            current += char;
            continue;
        }

        if (char === ',') {
            parts.push(current.trim());
            current = '';
            continue;
        }

        current += char;
    }

    if (quote) {
        throw new Error('Ação inválida: string não finalizada.');
    }

    if (current.trim() || text.endsWith(',')) {
        parts.push(current.trim());
    }

    return parts.map((part) => {
        if (part === 'this') return element;
        if (part === 'true') return true;
        if (part === 'false') return false;
        if (part === 'null') return null;

        if (/^-?\d+(?:\.\d+)?$/.test(part)) {
            return Number(part);
        }

        const first = part[0];
        const last = part[part.length - 1];

        if (
            (first === "'" && last === "'") ||
            (first === '"' && last === '"')
        ) {
            const body = part
                .slice(1, -1)
                .replace(/\\'/g, "'")
                .replace(/\\"/g, '"')
                .replace(/\\\\/g, '\\');

            return decodeKiraActionString(body);
        }

        throw new Error('Argumento de ação não permitido.');
    });
}

function setupKiraActionBridge() {
    document.addEventListener('click', (event) => {
        const target = event.target instanceof Element
            ? event.target.closest('[data-kira-action]')
            : null;

        if (!target || target.disabled) return;

        const expression = target.getAttribute('data-kira-action') || '';
        const match = expression.match(
            /^\s*([A-Za-z_$][\w$]*)\s*\(([\s\S]*)\)\s*;?\s*$/
        );

        if (!match) {
            console.error('Ação inválida bloqueada:', expression);
            return;
        }

        const [, actionName, argsSource] = match;
        const handler = KIRA_ACTION_HANDLERS[actionName];

        if (typeof handler !== 'function') {
            console.error('Ação não autorizada bloqueada:', actionName);
            return;
        }

        event.preventDefault();

        try {
            const args = parseKiraActionArgs(argsSource, target);
            const result = handler(...args);

            if (result && typeof result.catch === 'function') {
                result.catch((error) => {
                    console.error('Erro na ação:', actionName, error);
                    showAlert('Não foi possível concluir esta ação.', 'error');
                });
            }
        } catch (error) {
            console.error('Erro ao interpretar ação:', actionName, error);
            showAlert('Não foi possível concluir esta ação.', 'error');
        }
    });
}

document.addEventListener('DOMContentLoaded', setupKiraActionBridge);

