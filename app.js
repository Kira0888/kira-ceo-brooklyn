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
    services: [],
    professionals: []
};

// Make appState accessible globally
window.appState = appState;

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
        
        // Route to appropriate page
        const hash = window.location.hash.slice(1) || 'home';
        navigateTo(hash);

        // Listen for hash changes
        window.addEventListener('hashchange', () => {
            const hash = window.location.hash.slice(1);
            navigateTo(hash);
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
            appState.supabaseConfig.key
        );
    } catch (error) {
        console.error('Config load error:', error);
        throw error;
    }
}

function setupAuthStateListener() {
    if (!appState.supabaseClient) return;

    appState.supabaseClient.auth.onAuthStateChange((event, session) => {
        appState.currentSession = session;
        appState.currentUser = session?.user || null;
        updateUserInfo();
        updateNavigationByRole();

        if (event === 'SIGNED_OUT') {
            appState.workspaceData = null;
            appState.userRole = null;
            updateNavigationByRole();
            navigateTo('home');
            return;
        }

        if (event === 'SIGNED_IN') {
            loadWorkspaceData().then(() => {
                updateNavigationByRole();
                if (!appState.userRole && appState.currentPage === 'acesso-interno') {
                    renderInitialOwnerActivation();
                }
            });
        }
    });
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

        if (session) await loadWorkspaceData();
        else {
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

async function loadWorkspaceData() {
    try {
        if (!appState.currentSession) {
            appState.workspaceData = null;
            appState.userRole = null;
            updateNavigationByRole();
            return;
        }

        const response = await fetch(`${INTERNAL_ENDPOINT}?mode=workspace`, {
            headers: {
                'Authorization': `Bearer ${appState.currentSession.access_token}`,
                'apikey': appState.supabaseConfig.key
            }
        });

        if (response.status === 401) {
            appState.workspaceData = null;
            appState.userRole = null;
            updateNavigationByRole();
            await appState.supabaseClient.auth.signOut();
            return;
        }

        if (response.status === 403) {
            appState.workspaceData = null;
            appState.userRole = null;
            updateNavigationByRole();
            return;
        }

        if (!response.ok) throw new Error('Failed to load workspace');

        appState.workspaceData = await response.json();
        appState.userRole = appState.workspaceData.role || null;
        updateNavigationByRole();
    } catch (error) {
        console.error('Workspace load error:', error);
        appState.workspaceData = null;
        appState.userRole = null;
        updateNavigationByRole();
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
    
    // Check authentication for protected pages
    const protectedPages = ['agenda', 'financeiro', 'relatorios', 'configuracoes'];
    if (protectedPages.includes(page) && !appState.currentUser) {
        navigateTo('acesso-interno');
        return;
    }

    switch(page) {
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

function renderHomePage() {
    const content = document.getElementById('content');
    updateTopbar('Início', 'Kira-CEO Brooklyn');

    content.innerHTML = `
        <div class="content-inner">
            <div class="card">
                <div class="card-title">Bem-vindo ao Kira-CEO Brooklyn</div>
                <p>Sistema operacional para a Barbearia Brooklyn</p>
                <p style="margin-top: 1rem; color: #666; font-size: 0.9375rem;">
                    QS 121 — Samambaia — Brasília/DF
                </p>
                <div style="margin-top: 1.5rem;">
                    <a href="#agendamento" class="button button-primary">Fazer agendamento</a>
                    <a href="#acesso-interno" class="button button-secondary" style="margin-left: 0.75rem;">Acesso interno</a>
                </div>
            </div>

            <div class="card">
                <div class="card-title">Funcionalidades</div>
                <ul style="list-style: none;">
                    <li style="padding: 0.5rem 0; border-bottom: 1px solid #f0f0f0;">✓ Agendamento online</li>
                    <li style="padding: 0.5rem 0; border-bottom: 1px solid #f0f0f0;">✓ Gerenciamento de agenda</li>
                    <li style="padding: 0.5rem 0; border-bottom: 1px solid #f0f0f0;">✓ Controle financeiro</li>
                    <li style="padding: 0.5rem 0; border-bottom: 1px solid #f0f0f0;">✓ Relatórios operacionais</li>
                    <li style="padding: 0.5rem 0;">✓ Localização</li>
                </ul>
            </div>

            <div id="booking-status" style="display: none;">
            </div>
        </div>
    `;

    // Check for existing booking
    checkExistingBooking();
}

function checkExistingBooking() {
    try {
        const lastBooking = localStorage.getItem('last_appointment');
        if (!lastBooking) return;

        const booking = JSON.parse(lastBooking);
        const bookingStatus = document.getElementById('booking-status');
        if (bookingStatus) {
            bookingStatus.style.display = 'block';
            bookingStatus.innerHTML = `
                <div class="card">
                    <div class="card-title">Sua reserva</div>
                    <p>Você tem um agendamento em aberto.</p>
                    <a href="#agendamento" class="button button-secondary" style="margin-top: 1rem;">
                        Ver detalhes
                    </a>
                </div>
            `;
        }
    } catch (error) {
        console.error('Error checking booking:', error);
    }
}

async function renderBookingPage() {
    const content = document.getElementById('content');
    updateTopbar('Agendamento', 'Reserve seu horário');

    content.innerHTML = `
        <div class="content-inner">
            <div id="booking-container">
                <div style="text-align: center; padding: 2rem;">
                    <div class="loading" style="display: inline-block;"></div> Carregando...
                </div>
            </div>
        </div>
    `;

    try {
        // Check for existing booking first
        const lastBooking = localStorage.getItem('last_appointment');
        if (lastBooking) {
            const booking = JSON.parse(lastBooking);
            await renderBookingManagement(booking);
            return;
        }

        // Otherwise show booking form
        await checkBookingMode();
        
        const bookingHTML = getBookingHTML();
        let finalHTML = bookingHTML;
        
        if (appState.bookingState.mode === 'demo') {
            finalHTML = `
                <div class="demo-banner">
                    ⚠ AMBIENTE DEMO — Os dados abaixo são fictícios para demonstração
                </div>
                ${bookingHTML}
            `;
        }
        
        content.querySelector('#booking-container').innerHTML = finalHTML;

        await loadBookingCatalog();
        setupBookingListeners();
    } catch (error) {
        console.error('Booking page error:', error);
        content.querySelector('#booking-container').innerHTML = `
            <div class="alert alert-error">Erro ao carregar agendamento</div>
        `;
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
                        <button class="button button-danger" onclick="cancelPublicBooking('${booking.appointment_id}', '${booking.management_token}', '${booking.tenant}')">
                            Cancelar
                        </button>
                    ` : ''}
                    ${policy?.allow_public_reschedule ? `
                        <button class="button button-secondary" onclick="showRescheduleForm('${booking.appointment_id}', '${booking.management_token}', '${booking.tenant}', '${appt.service.id}', '${appt.professional.id}')">
                            Reagendar
                        </button>
                    ` : ''}
                    <button class="button button-secondary" onclick="navigateTo('home')">Voltar</button>
                    <button class="button button-secondary" onclick="forgetBookingThisDevice()" style="opacity: 0.7;">Esquecer neste dispositivo</button>
                </div>
            </div>
        `;

        content.querySelector('#booking-management-container').innerHTML = html;
    } catch (error) {
        console.error('Booking management error:', error);
        content.querySelector('#booking-management-container').innerHTML = `
            <div class="alert alert-error">Erro ao carregar detalhes da reserva</div>
            <button class="button button-secondary" onclick="navigateTo('home')" style="margin-top: 1rem;">Voltar</button>
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
                    <button class="button button-primary" onclick="submitReschedule('${appointmentId}', '${token}', '${tenant}')">
                        Confirmar reagendamento
                    </button>
                    <button class="button button-secondary" onclick="navigateTo('agendamento')">
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
    try {
        const response = await fetch(`${BOOKING_ENDPOINT}?mode=catalog&tenant=live`);
        if (!response.ok) throw new Error('Live mode unavailable');
        
        const data = await response.json();
        if (data.booking_enabled === true && data.services?.length > 0 && data.professionals?.length > 0) {
            appState.bookingState.mode = 'live';
            appState.bookingState.tenant = 'live';
        } else {
            appState.bookingState.mode = 'demo';
            appState.bookingState.tenant = 'demo';
        }
    } catch (error) {
        appState.bookingState.mode = 'demo';
        appState.bookingState.tenant = 'demo';
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
        <div class="card">
            <div class="card-title">Agendar serviço</div>
            
            <div class="form-group">
                <label>Serviço</label>
                <select id="service-select">
                    <option value="">Carregando...</option>
                </select>
            </div>

            <div class="form-group">
                <label>Profissional</label>
                <select id="professional-select">
                    <option value="">Selecione um serviço primeiro</option>
                </select>
            </div>

            <div class="form-group">
                <label>Data</label>
                <input type="date" id="booking-date" min="${getTodayDate()}">
            </div>

            <div class="form-group" id="time-container" style="display:none;">
                <label>Horário</label>
                <select id="time-select">
                    <option value="">Selecione um horário</option>
                </select>
            </div>

            <div class="form-group" id="customer-form" style="display:none;">
                <label>Nome completo</label>
                <input type="text" id="customer-name" placeholder="Seu nome">

                <label style="margin-top: 1rem;">Telefone</label>
                <input type="tel" id="customer-phone" placeholder="(61) 99999-9999">

                <div class="button-group" style="margin-top: 1.5rem;">
                    <button class="button button-primary" id="confirm-booking">Confirmar agendamento</button>
                    <button class="button button-secondary" id="cancel-booking">Cancelar</button>
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
    try {
        const service = document.getElementById('service-select').value;
        const professional = document.getElementById('professional-select').value;
        const startsAt = document.getElementById('time-select').value;
        const name = document.getElementById('customer-name').value.trim();
        const phone = document.getElementById('customer-phone').value.trim();

        if (!service || !professional || !startsAt || !name || !phone) {
            showAlert('Preencha todos os campos', 'error');
            return;
        }

        const idempotencyKey = crypto.randomUUID();

        const response = await fetch(`${BOOKING_ENDPOINT}?tenant=${appState.bookingState.tenant}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                service_id: service,
                professional_id: professional,
                starts_at: startsAt,
                customer_name: name,
                customer_phone: phone,
                idempotency_key: idempotencyKey
            })
        });

        if (!response.ok) throw new Error('Booking failed');
        
        const result = await response.json();
        
        // Store locally using result.appointment
        localStorage.setItem('last_appointment', JSON.stringify({
            appointment_id: result.appointment,
            management_token: result.management_token,
            tenant: appState.bookingState.tenant
        }));

        showAlert('Agendamento confirmado com sucesso.', 'success');
        setTimeout(() => navigateTo('home'), 2000);
    } catch (error) {
        console.error('Booking submit error:', error);
        showAlert('Erro ao confirmar agendamento', 'error');
    }
}

function renderLocationPage() {
    const content = document.getElementById('content');
    updateTopbar('Localização', 'Encontre-nos');

    content.innerHTML = `
        <div class="content-inner">
            <div class="card">
                <div class="card-title">Barbearia Brooklyn</div>
                <p><strong>Endereço:</strong><br>
                   QS 121 — Samambaia<br>
                   Brasília — DF</p>
                
                <a href="${MAPS_URL}" target="_blank" class="button button-primary" style="margin-top: 1.5rem;">
                    Abrir no Google Maps
                </a>
            </div>
        </div>
    `;
}

// ============================================================
// Authentication
// ============================================================

function renderAuthPage() {
    const content = document.getElementById('content');
    updateTopbar('Acesso interno', 'Autenticação');

    if (!appState.currentUser) {
        renderLoginForm();
        return;
    }

    if (!appState.userRole) {
        renderInitialOwnerActivation();
        return;
    }

    renderLoggedInAuth();
}

function renderLoginForm() {
    const content = document.getElementById('content');
    content.innerHTML = `
        <div class="content-inner">
            <div class="card" style="max-width: 400px; margin: 2rem auto;">
                <div class="card-title" style="text-align: center; margin-bottom: 2rem;">
                    Kira-CEO Brooklyn
                </div>

                <div class="form-group">
                    <label>E-mail</label>
                    <input type="email" id="login-email" placeholder="seu@email.com">
                </div>

                <div class="form-group">
                    <label>Senha</label>
                    <input type="password" id="login-password" placeholder="••••••••">
                </div>

                <button class="button button-primary" id="login-btn" style="width: 100%;">Entrar</button>

                <div style="text-align: center; margin-top: 1rem;">
                    <button class="button button-secondary" id="signup-toggle" style="width: 100%;">Criar conta</button>
                </div>

                <div id="auth-message" style="margin-top: 1rem;"></div>
            </div>
        </div>
    `;

    document.getElementById('login-btn').addEventListener('click', handleLogin);
    document.getElementById('signup-toggle').addEventListener('click', () => showSignupForm());
}

function showSignupForm() {
    const content = document.getElementById('content');
    content.innerHTML = `
        <div class="content-inner">
            <div class="card" style="max-width: 400px; margin: 2rem auto;">
                <div class="card-title" style="text-align: center; margin-bottom: 2rem;">
                    Criar conta
                </div>

                <div class="form-group">
                    <label>E-mail</label>
                    <input type="email" id="signup-email" placeholder="seu@email.com">
                </div>

                <div class="form-group">
                    <label>Senha</label>
                    <input type="password" id="signup-password" placeholder="••••••••">
                </div>

                <div class="form-group">
                    <label>Confirmar senha</label>
                    <input type="password" id="signup-password-confirm" placeholder="••••••••">
                </div>

                <button class="button button-primary" id="signup-btn" style="width: 100%;">Criar conta</button>

                <div style="text-align: center; margin-top: 1rem;">
                    <button class="button button-secondary" id="login-toggle" style="width: 100%;">Já tem conta?</button>
                </div>

                <div id="auth-message" style="margin-top: 1rem;"></div>
            </div>
        </div>
    `;

    document.getElementById('signup-btn').addEventListener('click', handleSignup);
    document.getElementById('login-toggle').addEventListener('click', () => renderLoginForm());
}

async function handleLogin() {
    try {
        const email = document.getElementById('login-email').value.trim();
        const password = document.getElementById('login-password').value;
        if (!email || !password) {
            showMessage('Preencha e-mail e senha', 'error');
            return;
        }

        const { data, error } = await appState.supabaseClient.auth.signInWithPassword({ email, password });
        if (error) throw error;

        appState.currentSession = data.session;
        appState.currentUser = data.user;
        await loadWorkspaceData();
        updateUserInfo();
        updateNavigationByRole();

        if (!appState.userRole) renderInitialOwnerActivation();
        else {
            showAlert('Bem-vindo!', 'success');
            setTimeout(() => navigateTo('agenda'), 700);
        }
    } catch (error) {
        console.error('Login error:', error);
        showMessage('Erro ao fazer login: ' + error.message, 'error');
    }
}

function renderInitialOwnerActivation() {
    const content = document.getElementById('content');
    updateTopbar('Ativar conta', 'Primeira configuração');

    content.innerHTML = `
        <div class="content-inner">
            <div class="card" style="max-width: 400px; margin: 2rem auto;">
                <div class="card-title">Ativar como proprietário</div>
                <p style="color: #666; margin-bottom: 1rem;">
                    Digite o código de ativação fornecido para configurar a conta como proprietário.
                </p>

                <div class="form-group">
                    <label>Código de ativação</label>
                    <input type="text" id="activation-code" placeholder="Digite o código">
                </div>

                <button class="button button-primary" id="activate-btn" style="width: 100%;">Ativar</button>

                <div id="auth-message" style="margin-top: 1rem;"></div>
            </div>
        </div>
    `;

    document.getElementById('activate-btn').addEventListener('click', handleOwnerActivation);
}

async function handleOwnerActivation() {
    try {
        const token = document.getElementById('activation-code').value.trim();

        if (!token) {
            showMessage('Digite o código de ativação', 'error');
            return;
        }

        const { data, error } = await appState.supabaseClient.rpc('claim_initial_owner', {
            p_org_slug: 'brooklyn-qs-121',
            p_token: token
        });

        if (error) throw error;

        // Reload workspace data to get updated role from backend
        await loadWorkspaceData();
        updateUserInfo();
        updateNavigationByRole();

        showAlert('Conta ativada com sucesso!', 'success');
        setTimeout(() => navigateTo('agenda'), 1500);
    } catch (error) {
        console.error('Activation error:', error);
        showMessage('Erro ao ativar: ' + error.message, 'error');
    }
}

async function handleSignup() {
    try {
        const email = document.getElementById('signup-email').value.trim();
        const password = document.getElementById('signup-password').value;
        const passwordConfirm = document.getElementById('signup-password-confirm').value;

        if (!email || !password || !passwordConfirm) {
            showMessage('Preencha todos os campos', 'error');
            return;
        }

        if (password !== passwordConfirm) {
            showMessage('As senhas não correspondem', 'error');
            return;
        }

        const { data, error } = await appState.supabaseClient.auth.signUp({
            email,
            password
        });

        if (error) throw error;

        if (data.session) {
            appState.currentSession = data.session;
            appState.currentUser = data.user;
            updateUserInfo();
            showAlert('Conta criada e sessão iniciada.', 'success');
            setTimeout(() => renderInitialOwnerActivation(), 1500);
        } else {
            showAlert('Conta criada. Confirme seu e-mail para continuar.', 'success');
            setTimeout(() => renderLoginForm(), 2000);
        }
    } catch (error) {
        console.error('Signup error:', error);
        showMessage('Erro ao criar conta: ' + error.message, 'error');
    }
}

function renderLoggedInAuth() {
    const content = document.getElementById('content');
    const userEmail = sanitizeText(appState.currentUser.email);
    
    content.innerHTML = `
        <div class="content-inner">
            <div class="card" style="max-width: 400px; margin: 2rem auto;">
                <div class="card-title">Conectado</div>
                <p>E-mail: <strong>${userEmail}</strong></p>
                <p>Função: <strong>${appState.userRole || 'Carregando...'}</strong></p>

                <button class="button button-primary" id="dashboard-btn" style="width: 100%; margin-top: 1rem;">
                    Ir para painel
                </button>

                <button class="button button-danger" id="logout-btn" style="width: 100%; margin-top: 0.5rem;">
                    Sair
                </button>
            </div>
        </div>
    `;

    document.getElementById('logout-btn').addEventListener('click', handleLogout);
    document.getElementById('dashboard-btn').addEventListener('click', () => navigateTo('agenda'));
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
    updateTopbar('Agenda', `${new Date().toLocaleDateString('pt-BR')}`);

    content.innerHTML = `
        <div class="content-inner">
            <div id="schedule-loading" style="text-align: center; padding: 2rem;">
                <div class="loading" style="display: inline-block;"></div> Carregando agenda...
            </div>
        </div>
    `;

    try {
        if (!appState.workspaceData) {
            await loadWorkspaceData();
        }

        const agenda = appState.workspaceData?.agenda || [];
        
        if (agenda.length === 0) {
            content.innerHTML = `
                <div class="content-inner">
                    <div class="card">
                        <div class="card-title">Agenda</div>
                        <p class="text-muted">Nenhum agendamento para hoje</p>
                    </div>
                </div>
            `;
            return;
        }

        let tableHtml = '<table><thead><tr><th>Horário</th><th>Cliente</th><th>Serviço</th><th>Profissional</th><th>Estado</th><th>Ações</th></tr></thead><tbody>';
        
        agenda.forEach(appt => {
            const state = sanitizeText(appt.state || 'BOOKED');
            const stateBadge = `<span class="badge badge-info">${state}</span>`;
            const time = new Date(appt.starts_at).toLocaleTimeString('pt-BR', {
                hour: '2-digit',
                minute: '2-digit',
                timeZone: 'America/Sao_Paulo'
            });
            
            let actionButtons = '';
            
            if (['BOOKED', 'CONFIRMED'].includes(appt.state)) {
                actionButtons = `
                    <button class="button button-secondary" onclick="updateAppointmentStatus('${appt.appointment_id}', 'IN_SERVICE')" style="padding: 0.5rem 1rem; font-size: 0.875rem; margin-bottom: 0.25rem;">Iniciar</button>
                    <button class="button button-danger" onclick="updateAppointmentStatus('${appt.appointment_id}', 'NO_SHOW')" style="padding: 0.5rem 1rem; font-size: 0.875rem;">Faltou</button>
                `;
            } else if (appt.state === 'IN_SERVICE') {
                actionButtons = `
                    <button class="button button-primary" onclick="updateAppointmentStatus('${appt.appointment_id}', 'COMPLETED')" style="padding: 0.5rem 1rem; font-size: 0.875rem;">Concluir</button>
                `;
            }
            
            tableHtml += `
                <tr>
                    <td>${time}</td>
                    <td>${sanitizeText(appt.customer_name || '—')}</td>
                    <td>${sanitizeText(appt.service?.name || '—')}</td>
                    <td>${sanitizeText(appt.professional?.display_name || '—')}</td>
                    <td>${stateBadge}</td>
                    <td>${actionButtons}</td>
                </tr>
            `;
        });
        
        tableHtml += '</tbody></table>';

        content.innerHTML = `
            <div class="content-inner">
                <div class="card">
                    <div class="card-title">Agenda</div>
                    ${tableHtml}
                </div>
            </div>
        `;
    } catch (error) {
        console.error('Schedule page error:', error);
        content.innerHTML = `
            <div class="content-inner">
                <div class="alert alert-error">Erro ao carregar agenda: ${error.message}</div>
            </div>
        `;
    }
}

async function updateAppointmentStatus(appointmentId, newState) {
    try {
        const response = await fetch(INTERNAL_ENDPOINT, {
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

        if (!response.ok) throw new Error('Failed to update status');
        
        // Refresh workspace data and re-render
        appState.workspaceData = null;
        await loadWorkspaceData();
        showAlert('Status atualizado com sucesso', 'success');
        renderSchedulePage();
    } catch (error) {
        console.error('Status update error:', error);
        showAlert('Erro ao atualizar status', 'error');
    }
}

async function renderFinancialPage() {
    const content = document.getElementById('content');
    updateTopbar('Financeiro', 'Caixa e movimentações');

    content.innerHTML = `
        <div class="content-inner">
            <div id="financial-loading" style="text-align: center; padding: 2rem;">
                <div class="loading" style="display: inline-block;"></div> Carregando dados financeiros...
            </div>
        </div>
    `;

    try {
        if (!appState.workspaceData) {
            await loadWorkspaceData();
        }

        const financial = appState.workspaceData?.financial || {};
        const orders = financial.orders || [];
        const cash = financial.cash || [];
        const agenda = appState.workspaceData?.agenda || [];

        // Calculate totals
        const recebido = orders.reduce((sum, order) => sum + (order.paid_cents || 0), 0);
        const aReceber = orders.reduce((sum, order) => sum + (order.balance_cents || 0), 0);
        const vendas = orders.reduce((sum, order) => sum + (order.total_cents || 0), 0);

        let html = `
            <div class="card">
                <div class="card-title">Resumo financeiro</div>
                <table style="width: 100%;">
                    <tr><td>Vendas:</td><td><strong>R$ ${(vendas / 100).toFixed(2)}</strong></td></tr>
                    <tr><td>Recebido:</td><td><strong>R$ ${(recebido / 100).toFixed(2)}</strong></td></tr>
                    <tr><td>A receber:</td><td><strong>R$ ${(aReceber / 100).toFixed(2)}</strong></td></tr>
                </table>
            </div>
        `;

        // Cash session
        if (cash.length > 0) {
            const session = cash[0];
            const expectedCash = session.status === 'OPEN' 
                ? session.expected_cash_now_cents 
                : session.expected_cash_cents_snapshot;
            
            html += `
                <div class="card">
                    <div class="card-title">Caixa</div>
                    <table style="width: 100%;">
                        <tr><td>Status:</td><td><strong>${session.status === 'OPEN' ? 'ABERTO' : 'FECHADO'}</strong></td></tr>
                        <tr><td>Abertura:</td><td>R$ ${(session.opening_cash_cents / 100).toFixed(2)}</td></tr>
                        <tr><td>Esperado:</td><td>R$ ${(expectedCash / 100).toFixed(2)}</td></tr>
                        ${session.counted_cash_cents !== null ? `<tr><td>Contado:</td><td>R$ ${(session.counted_cash_cents / 100).toFixed(2)}</td></tr>` : ''}
                        ${session.difference_cents !== null ? `<tr><td>Diferença:</td><td>R$ ${(session.difference_cents / 100).toFixed(2)}</td></tr>` : ''}
                    </table>
                    <div class="button-group" style="margin-top: 1rem;">
                        ${session.status === 'OPEN' ? `
                            <button class="button button-danger" onclick="openCloseCashDialog('${session.cash_session_id}')">Fechar caixa</button>
                        ` : `
                            <button class="button button-primary" onclick="openCashDialog()">Abrir caixa</button>
                        `}
                    </div>
                </div>
            `;
        } else {
            html += `
                <div class="card">
                    <div class="card-title">Caixa</div>
                    <p class="text-muted">Nenhuma sessão aberta</p>
                    <button class="button button-primary" onclick="openCashDialog()" style="margin-top: 1rem;">Abrir caixa</button>
                </div>
            `;
        }

        // Orders
        if (orders.length > 0) {
            html += `
                <div class="card">
                    <div class="card-title">Comandas</div>
                    <table>
                        <thead>
                            <tr>
                                <th>Cliente</th>
                                <th>Total</th>
                                <th>Pago</th>
                                <th>Saldo</th>
                                <th>Ações</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${orders.map(order => {
                                // Find customer name from agenda
                                const agendaItem = agenda.find(a => a.appointment_id === order.appointment_id);
                                const customerName = agendaItem?.customer_name || `Atendimento ${order.order_id.slice(0, 8)}`;
                                
                                return `
                                    <tr>
                                        <td>${sanitizeText(customerName)}</td>
                                        <td>R$ ${((order.total_cents || 0) / 100).toFixed(2)}</td>
                                        <td>R$ ${((order.paid_cents || 0) / 100).toFixed(2)}</td>
                                        <td>R$ ${((order.balance_cents || 0) / 100).toFixed(2)}</td>
                                        <td>
                                            ${order.balance_cents > 0 ? `
                                                <button class="button button-secondary" onclick="openCheckoutDialog('${order.appointment_id}', ${order.balance_cents})" style="padding: 0.5rem 1rem; font-size: 0.875rem;">Receber</button>
                                            ` : ''}
                                        </td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        }

        content.innerHTML = `<div class="content-inner">${html}</div>`;
    } catch (error) {
        console.error('Financial page error:', error);
        content.innerHTML = `
            <div class="content-inner">
                <div class="alert alert-error">Erro ao carregar dados financeiros: ${error.message}</div>
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
                    <button class="button button-primary" onclick="submitOpenCash()">Abrir</button>
                    <button class="button button-secondary" onclick="navigateTo('financeiro')">Cancelar</button>
                </div>
            </div>
        </div>
    `;
}

async function submitOpenCash() {
    try {
        const openingCashReais = parseFloat(document.getElementById('opening-cash').value);
        
        if (isNaN(openingCashReais) || openingCashReais < 0) {
            showAlert('Digite um valor válido', 'error');
            return;
        }

        const openingCashCents = Math.round(openingCashReais * 100);

        const response = await fetch(INTERNAL_ENDPOINT, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${appState.currentSession.access_token}`,
                'apikey': appState.supabaseConfig.key,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                action: 'open-cash',
                opening_cash_cents: openingCashCents
            })
        });

        if (!response.ok) throw new Error('Failed to open cash');
        
        // Refresh workspace data and re-render
        appState.workspaceData = null;
        await loadWorkspaceData();
        showAlert('Caixa aberto com sucesso', 'success');
        setTimeout(() => renderFinancialPage(), 1500);
    } catch (error) {
        console.error('Open cash error:', error);
        showAlert('Erro ao abrir caixa', 'error');
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
                    <button class="button button-primary" onclick="submitCloseCash('${cashSessionId}')">Fechar</button>
                    <button class="button button-secondary" onclick="navigateTo('financeiro')">Cancelar</button>
                </div>
            </div>
        </div>
    `;
}

async function submitCloseCash(cashSessionId) {
    try {
        const countedCashReais = parseFloat(document.getElementById('counted-cash').value);
        
        if (isNaN(countedCashReais) || countedCashReais < 0) {
            showAlert('Digite um valor válido', 'error');
            return;
        }

        const countedCashCents = Math.round(countedCashReais * 100);

        const response = await fetch(INTERNAL_ENDPOINT, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${appState.currentSession.access_token}`,
                'apikey': appState.supabaseConfig.key,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                action: 'close-cash',
                cash_session_id: cashSessionId,
                counted_cash_cents: countedCashCents
            })
        });

        if (!response.ok) throw new Error('Failed to close cash');
        
        // Refresh workspace data and re-render
        appState.workspaceData = null;
        await loadWorkspaceData();
        showAlert('Caixa fechado com sucesso', 'success');
        setTimeout(() => renderFinancialPage(), 1500);
    } catch (error) {
        console.error('Close cash error:', error);
        showAlert('Erro ao fechar caixa', 'error');
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
                    <button class="button button-primary" onclick="submitCheckout('${appointmentId}')">Registrar pagamento</button>
                    <button class="button button-secondary" onclick="navigateTo('financeiro')">Cancelar</button>
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
    try {
        const method = document.getElementById('payment-method').value;
        const amountReais = parseFloat(document.getElementById('payment-amount').value);
        if (!method || isNaN(amountReais) || amountReais <= 0) {
            showAlert('Preencha os dados corretamente', 'error');
            return;
        }

        const amountCents = Math.round(amountReais * 100);
        const financial = appState.workspaceData?.financial || {};
        const openCashSession = (financial.cash || []).find(session => session.status === 'OPEN');
        if (method === 'CASH' && !openCashSession) {
            showAlert('Abra o caixa antes de registrar pagamento em dinheiro', 'error');
            return;
        }

        const response = await fetch(INTERNAL_ENDPOINT, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${appState.currentSession.access_token}`,
                'apikey': appState.supabaseConfig.key,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                action: 'checkout',
                appointment_id: appointmentId,
                discount_cents: 0,
                payments: [{ method, amount_cents: amountCents }],
                cash_session_id: method === 'CASH' ? openCashSession.cash_session_id : null,
                idempotency_key: crypto.randomUUID()
            })
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.detail || payload.error || 'Checkout failed');
        const result = payload.result || {};
        const paid = Number(result.paid_cents || 0);
        const balance = Number(result.balance_cents || 0);
        const status = String(result.status || 'pendente');

        appState.workspaceData = null;
        await loadWorkspaceData();
        showAlert(`Pagamento registrado. Status: ${status} | Recebido: R$ ${(paid / 100).toFixed(2)} | Saldo: R$ ${(balance / 100).toFixed(2)}`, 'success');
        setTimeout(() => renderFinancialPage(), 700);
    } catch (error) {
        console.error('Checkout error:', error);
        showAlert('Erro ao registrar pagamento: ' + error.message, 'error');
    }
}

async function renderReportsPage() {
    const content = document.getElementById('content');
    updateTopbar('Relatórios', 'Análise e métricas');

    content.innerHTML = `
        <div class="content-inner">
            <div id="reports-loading" style="text-align: center; padding: 2rem;">
                <div class="loading" style="display: inline-block;"></div> Carregando relatórios...
            </div>
        </div>
    `;

    try {
        if (!appState.workspaceData) {
            await loadWorkspaceData();
        }

        const agenda = appState.workspaceData?.agenda || [];
        const financial = appState.workspaceData?.financial || {};
        const commission = financial.commission || [];

        // Calculate metrics from agenda
        const total = agenda.length;
        const completed = agenda.filter(a => a.state === 'COMPLETED').length;
        const noShow = agenda.filter(a => a.state === 'NO_SHOW').length;
        const cancelled = agenda.filter(a => a.state === 'CANCELLED').length;

        // Calculate financial metrics
        const orders = financial.orders || [];
        const vendas = orders.reduce((sum, order) => sum + (order.total_cents || 0), 0);
        const recebido = orders.reduce((sum, order) => sum + (order.paid_cents || 0), 0);
        const aReceber = orders.reduce((sum, order) => sum + (order.balance_cents || 0), 0);

        let html = `
            <div class="card">
                <div class="card-title">Indicadores operacionais</div>
                <table style="width: 100%;">
                    <tr><td>Agendamentos hoje:</td><td><strong>${total}</strong></td></tr>
                    <tr><td>Concluídos:</td><td><strong>${completed}</strong></td></tr>
                    <tr><td>Faltas:</td><td><strong>${noShow}</strong></td></tr>
                    <tr><td>Cancelados:</td><td><strong>${cancelled}</strong></td></tr>
                </table>
            </div>

            <div class="card">
                <div class="card-title">Indicadores financeiros</div>
                <table style="width: 100%;">
                    <tr><td>Vendas:</td><td><strong>R$ ${(vendas / 100).toFixed(2)}</strong></td></tr>
                    <tr><td>Recebido:</td><td><strong>R$ ${(recebido / 100).toFixed(2)}</strong></td></tr>
                    <tr><td>A receber:</td><td><strong>R$ ${(aReceber / 100).toFixed(2)}</strong></td></tr>
                </table>
            </div>
        `;

        // Commission
        if (commission.length > 0) {
            html += `
                <div class="card">
                    <div class="card-title">Comissões</div>
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
                                    <td>R$ ${((c.accrued_cents || 0) / 100).toFixed(2)}</td>
                                    <td>R$ ${((c.adjustment_cents || 0) / 100).toFixed(2)}</td>
                                    <td>R$ ${((c.paid_out_cents || 0) / 100).toFixed(2)}</td>
                                    <td>R$ ${((c.payable_cents || 0) / 100).toFixed(2)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        }

        content.innerHTML = `<div class="content-inner">${html}</div>`;
    } catch (error) {
        console.error('Reports page error:', error);
        content.innerHTML = `
            <div class="content-inner">
                <div class="alert alert-error">Erro ao carregar relatórios: ${error.message}</div>
            </div>
        `;
    }
}

async function renderConfigurationPage() {
    const content = document.getElementById('content');
    updateTopbar('Configurações', 'Gerenciamento da unidade');

    if (appState.userRole === 'BARBER') {
        navigateTo('home');
        return;
    }

    content.innerHTML = `
        <div class="content-inner">
            <div style="display: flex; gap: 1rem; margin-bottom: 1.5rem; flex-wrap: wrap;">
                <button class="button button-primary" onclick="showServicesConfig()">Serviços</button>
                <button class="button button-primary" onclick="showProfessionalsConfig()">Profissionais</button>
                <button class="button button-primary" onclick="showProfessionalServicesConfig()">Vincular serviços</button>
                <button class="button button-primary" onclick="showProfessionalHoursConfig()">Expediente</button>
                ${appState.userRole === 'OWNER' ? `
                    <button class="button button-primary" onclick="showCommissionRulesConfig()">Comissões</button>
                    <button class="button button-primary" onclick="showBookingPoliciesConfig()">Política de agendamento</button>
                ` : ''}
            </div>
            <div id="config-content">
                <div class="card">
                    <p>Selecione uma opção acima para gerenciar.</p>
                </div>
            </div>
        </div>
    `;
}

async function showServicesConfig() {
    const configContent = document.getElementById('config-content');
    const orgId = appState.workspaceData?.organization?.id;
    configContent.innerHTML = '<div class="card"><div style="text-align:center;padding:2rem"><div class="loading" style="display:inline-block"></div> Carregando serviços...</div></div>';
    try {
        const { data: services, error } = await appState.supabaseClient
            .from('services')
            .select('id,name,price_cents,duration_minutes,buffer_after_minutes,active')
            .eq('organization_id', orgId)
            .order('name');
        if (error) throw error;

        configContent.innerHTML = `
            <div class="card">
                <div class="card-title">Serviços</div>
                <button class="button button-primary" onclick="showAddServiceForm()" style="margin-bottom:1rem">Adicionar serviço</button>
                ${(services || []).length ? `
                    <table><thead><tr><th>Nome</th><th>Preço</th><th>Duração</th><th>Buffer</th><th>Ativo</th></tr></thead><tbody>
                    ${(services || []).map(s => `<tr><td>${sanitizeText(s.name)}</td><td>R$ ${((s.price_cents || 0)/100).toFixed(2)}</td><td>${s.duration_minutes} min</td><td>${s.buffer_after_minutes || 0} min</td><td>${s.active ? 'Sim' : 'Não'}</td></tr>`).join('')}
                    </tbody></table>` : '<p class="text-muted">Nenhum serviço cadastrado</p>'}
            </div>`;
    } catch (error) {
        console.error('Load services error:', error);
        configContent.innerHTML = `<div class="alert alert-error">Erro ao carregar serviços: ${sanitizeText(error.message)}</div>`;
    }
}

function showAddServiceForm() {
    const configContent = document.getElementById('config-content');
    configContent.innerHTML = `
        <div class="card" style="max-width: 500px;">
            <div class="card-title">Novo serviço</div>
            
            <div class="form-group">
                <label>Nome</label>
                <input type="text" id="service-name" placeholder="Nome do serviço">
            </div>

            <div class="form-group">
                <label>Preço (R$)</label>
                <input type="number" id="service-price" placeholder="0,00" step="0.01" min="0">
            </div>

            <div class="form-group">
                <label>Duração (minutos)</label>
                <input type="number" id="service-duration" placeholder="30" step="1" min="1">
            </div>

            <div class="form-group">
                <label>Buffer após atendimento (minutos)</label>
                <input type="number" id="service-buffer" placeholder="5" step="1" min="0">
            </div>

            <div class="form-group">
                <label>
                    <input type="checkbox" id="service-active" checked> Ativo
                </label>
            </div>

            <div class="button-group">
                <button class="button button-primary" onclick="submitAddService()">Salvar</button>
                <button class="button button-secondary" onclick="showServicesConfig()">Cancelar</button>
            </div>
        </div>
    `;
}

async function submitAddService() {
    try {
        const name = document.getElementById('service-name').value.trim();
        const priceReais = parseFloat(document.getElementById('service-price').value);
        const duration = parseInt(document.getElementById('service-duration').value);
        const buffer = parseInt(document.getElementById('service-buffer').value) || 0;
        const active = document.getElementById('service-active').checked;
        const orgId = appState.workspaceData?.organization?.id;

        if (!name || isNaN(priceReais) || isNaN(duration)) {
            showAlert('Preencha os dados obrigatórios', 'error');
            return;
        }

        const priceCents = Math.round(priceReais * 100);

        const { data, error } = await appState.supabaseClient
            .from('services')
            .insert([{
                organization_id: orgId,
                name,
                price_cents: priceCents,
                duration_minutes: duration,
                buffer_after_minutes: buffer,
                active
            }]);

        if (error) throw error;

        // Refresh workspace data and re-render
        appState.workspaceData = null;
        await loadWorkspaceData();
        showAlert('Serviço criado com sucesso', 'success');
        setTimeout(() => showServicesConfig(), 1000);
    } catch (error) {
        console.error('Add service error:', error);
        showAlert('Erro ao criar serviço: ' + error.message, 'error');
    }
}

async function showProfessionalsConfig() {
    const configContent = document.getElementById('config-content');
    const orgId = appState.workspaceData?.organization?.id;
    configContent.innerHTML = '<div class="card"><div style="text-align:center;padding:2rem"><div class="loading" style="display:inline-block"></div> Carregando profissionais...</div></div>';
    try {
        const { data: professionals, error } = await appState.supabaseClient
            .from('professionals')
            .select('id,display_name,active,auth_user_id')
            .eq('organization_id', orgId)
            .order('display_name');
        if (error) throw error;
        configContent.innerHTML = `
            <div class="card"><div class="card-title">Profissionais</div>
            <button class="button button-primary" onclick="showAddProfessionalForm()" style="margin-bottom:1rem">Adicionar profissional</button>
            ${(professionals || []).length ? `<table><thead><tr><th>Nome</th><th>Ativo</th></tr></thead><tbody>${(professionals || []).map(p => `<tr><td>${sanitizeText(p.display_name)}</td><td>${p.active ? 'Sim' : 'Não'}</td></tr>`).join('')}</tbody></table>` : '<p class="text-muted">Nenhum profissional cadastrado</p>'}
            </div>`;
    } catch (error) {
        console.error('Load professionals error:', error);
        configContent.innerHTML = `<div class="alert alert-error">Erro ao carregar profissionais: ${sanitizeText(error.message)}</div>`;
    }
}

function showAddProfessionalForm() {
    const configContent = document.getElementById('config-content');
    configContent.innerHTML = `
        <div class="card" style="max-width: 500px;">
            <div class="card-title">Novo profissional</div>
            
            <div class="form-group">
                <label>Nome</label>
                <input type="text" id="professional-name" placeholder="Nome do profissional">
            </div>

            <div class="form-group">
                <label>
                    <input type="checkbox" id="professional-active" checked> Ativo
                </label>
            </div>

            <div class="button-group">
                <button class="button button-primary" onclick="submitAddProfessional()">Salvar</button>
                <button class="button button-secondary" onclick="showProfessionalsConfig()">Cancelar</button>
            </div>
        </div>
    `;
}

async function submitAddProfessional() {
    try {
        const name = document.getElementById('professional-name').value.trim();
        const active = document.getElementById('professional-active').checked;
        const orgId = appState.workspaceData?.organization?.id;

        if (!name) {
            showAlert('Digite o nome do profissional', 'error');
            return;
        }

        const { data, error } = await appState.supabaseClient
            .from('professionals')
            .insert([{
                organization_id: orgId,
                display_name: name,
                active
            }]);

        if (error) throw error;

        // Refresh workspace data and re-render
        appState.workspaceData = null;
        await loadWorkspaceData();
        showAlert('Profissional criado com sucesso', 'success');
        setTimeout(() => showProfessionalsConfig(), 1000);
    } catch (error) {
        console.error('Add professional error:', error);
        showAlert('Erro ao criar profissional: ' + error.message, 'error');
    }
}

async function showProfessionalServicesConfig() {
    const configContent = document.getElementById('config-content');
    const orgId = appState.workspaceData?.organization?.id;
    configContent.innerHTML = '<div class="card"><div style="text-align:center;padding:2rem"><div class="loading" style="display:inline-block"></div> Carregando vínculos...</div></div>';
    try {
        const [{ data: professionals, error: profError }, { data: services, error: servError }, { data: links, error: linkError }] = await Promise.all([
            appState.supabaseClient.from('professionals').select('id,display_name,active').eq('organization_id', orgId),
            appState.supabaseClient.from('services').select('id,name,active').eq('organization_id', orgId),
            appState.supabaseClient.from('professional_services').select('professional_id,service_id').eq('organization_id', orgId)
        ]);
        if (profError) throw profError; if (servError) throw servError; if (linkError) throw linkError;
        const pMap = Object.fromEntries((professionals || []).map(p => [p.id, p]));
        const sMap = Object.fromEntries((services || []).map(s => [s.id, s]));
        configContent.innerHTML = `
            <div class="card"><div class="card-title">Vínculos profissional × serviço</div>
            <button class="button button-primary" onclick="showAddProfessionalServiceForm()" style="margin-bottom:1rem">Adicionar vínculo</button>
            ${(links || []).length ? `<table><thead><tr><th>Profissional</th><th>Serviço</th></tr></thead><tbody>${(links || []).map(l => `<tr><td>${sanitizeText(pMap[l.professional_id]?.display_name || '—')}</td><td>${sanitizeText(sMap[l.service_id]?.name || '—')}</td></tr>`).join('')}</tbody></table>` : '<p class="text-muted">Nenhum vínculo cadastrado</p>'}
            </div>`;
    } catch (error) {
        console.error('Load professional services config error:', error);
        configContent.innerHTML = `<div class="alert alert-error">Erro ao carregar vínculos: ${sanitizeText(error.message)}</div>`;
    }
}

async function showAddProfessionalServiceForm() {
    const configContent = document.getElementById('config-content');
    const orgId = appState.workspaceData?.organization?.id;
    configContent.innerHTML = '<div class="card"><div style="text-align:center;padding:2rem"><div class="loading" style="display:inline-block"></div> Carregando...</div></div>';
    try {
        const [{ data: professionals, error: profError }, { data: services, error: servError }] = await Promise.all([
            appState.supabaseClient.from('professionals').select('id,display_name,active').eq('organization_id', orgId).eq('active', true).order('display_name'),
            appState.supabaseClient.from('services').select('id,name,active').eq('organization_id', orgId).eq('active', true).order('name')
        ]);
        if (profError) throw profError; if (servError) throw servError;
        configContent.innerHTML = `
            <div class="card" style="max-width:500px"><div class="card-title">Novo vínculo</div>
            <div class="form-group"><label>Profissional</label><select id="prof-select"><option value="">Selecione</option>${(professionals || []).map(p => `<option value="${p.id}">${sanitizeText(p.display_name)}</option>`).join('')}</select></div>
            <div class="form-group"><label>Serviço</label><select id="service-select-link"><option value="">Selecione</option>${(services || []).map(s => `<option value="${s.id}">${sanitizeText(s.name)}</option>`).join('')}</select></div>
            <div class="button-group"><button class="button button-primary" onclick="submitAddProfessionalService()">Vincular</button><button class="button button-secondary" onclick="showProfessionalServicesConfig()">Cancelar</button></div>
            </div>`;
    } catch (error) {
        console.error('Load professional service form error:', error);
        configContent.innerHTML = `<div class="alert alert-error">Erro ao carregar formulário: ${sanitizeText(error.message)}</div>`;
    }
}

async function submitAddProfessionalService() {
    try {
        const profId = document.getElementById('prof-select').value;
        const serviceId = document.getElementById('service-select-link').value;
        const orgId = appState.workspaceData?.organization?.id;
        if (!profId || !serviceId) { showAlert('Selecione profissional e serviço', 'error'); return; }
        const { error } = await appState.supabaseClient.from('professional_services').upsert([{
            organization_id: orgId, professional_id: profId, service_id: serviceId
        }], { onConflict: 'professional_id,service_id' });
        if (error) throw error;
        appState.workspaceData = null; await loadWorkspaceData();
        showAlert('Vínculo salvo com sucesso', 'success');
        setTimeout(() => showProfessionalServicesConfig(), 500);
    } catch (error) {
        console.error('Add professional service error:', error);
        showAlert('Erro ao salvar vínculo: ' + error.message, 'error');
    }
}

async function showProfessionalHoursConfig() {
    const configContent = document.getElementById('config-content');
    const orgId = appState.workspaceData?.organization?.id;
    configContent.innerHTML = '<div class="card"><div style="text-align:center;padding:2rem"><div class="loading" style="display:inline-block"></div> Carregando expedientes...</div></div>';
    try {
        const [{ data: professionals, error: profError }, { data: hours, error: hoursError }] = await Promise.all([
            appState.supabaseClient.from('professionals').select('id,display_name,active').eq('organization_id', orgId),
            appState.supabaseClient.from('professional_hours').select('professional_id,weekday,opens_at,closes_at,closed').eq('organization_id', orgId).order('weekday')
        ]);
        if (profError) throw profError; if (hoursError) throw hoursError;
        const pMap = Object.fromEntries((professionals || []).map(p => [p.id, p.display_name]));
        const days = {1:'Segunda',2:'Terça',3:'Quarta',4:'Quinta',5:'Sexta',6:'Sábado',7:'Domingo'};
        configContent.innerHTML = `
            <div class="card"><div class="card-title">Expediente</div>
            <button class="button button-primary" onclick="showAddProfessionalHoursForm()" style="margin-bottom:1rem">Adicionar/editar expediente</button>
            ${(hours || []).length ? `<table><thead><tr><th>Profissional</th><th>Dia</th><th>Horário</th></tr></thead><tbody>${(hours || []).map(h => `<tr><td>${sanitizeText(pMap[h.professional_id] || '—')}</td><td>${days[h.weekday] || h.weekday}</td><td>${h.closed ? 'Fechado' : `${String(h.opens_at || '').slice(0,5)}–${String(h.closes_at || '').slice(0,5)}`}</td></tr>`).join('')}</tbody></table>` : '<p class="text-muted">Nenhum expediente configurado</p>'}
            </div>`;
    } catch (error) {
        console.error('Load professional hours config error:', error);
        configContent.innerHTML = `<div class="alert alert-error">Erro ao carregar expedientes: ${sanitizeText(error.message)}</div>`;
    }
}

async function showAddProfessionalHoursForm() {
    const configContent = document.getElementById('config-content');
    const orgId = appState.workspaceData?.organization?.id;
    configContent.innerHTML = '<div class="card"><div style="text-align:center;padding:2rem"><div class="loading" style="display:inline-block"></div> Carregando...</div></div>';
    try {
        const { data: professionals, error } = await appState.supabaseClient.from('professionals').select('id,display_name,active').eq('organization_id', orgId).eq('active', true).order('display_name');
        if (error) throw error;
        const weekdays = [{id:1,name:'Segunda'},{id:2,name:'Terça'},{id:3,name:'Quarta'},{id:4,name:'Quinta'},{id:5,name:'Sexta'},{id:6,name:'Sábado'},{id:7,name:'Domingo'}];
        configContent.innerHTML = `
            <div class="card" style="max-width:500px"><div class="card-title">Expediente</div>
            <div class="form-group"><label>Profissional</label><select id="prof-hours-select"><option value="">Selecione</option>${(professionals || []).map(p => `<option value="${p.id}">${sanitizeText(p.display_name)}</option>`).join('')}</select></div>
            <div class="form-group"><label>Dia da semana</label><select id="weekday-select"><option value="">Selecione</option>${weekdays.map(w => `<option value="${w.id}">${w.name}</option>`).join('')}</select></div>
            <div class="form-group"><label>Abertura</label><input type="time" id="hours-opens"></div>
            <div class="form-group"><label>Fechamento</label><input type="time" id="hours-closes"></div>
            <div class="form-group"><label><input type="checkbox" id="hours-closed"> Fechado neste dia</label></div>
            <div class="button-group"><button class="button button-primary" onclick="submitAddProfessionalHours()">Salvar</button><button class="button button-secondary" onclick="showProfessionalHoursConfig()">Cancelar</button></div>
            </div>`;
    } catch (error) {
        console.error('Load professional hours form error:', error);
        configContent.innerHTML = `<div class="alert alert-error">Erro ao carregar formulário: ${sanitizeText(error.message)}</div>`;
    }
}

async function submitAddProfessionalHours() {
    try {
        const profId = document.getElementById('prof-hours-select').value;
        const weekday = Number(document.getElementById('weekday-select').value);
        const opensAt = document.getElementById('hours-opens').value;
        const closesAt = document.getElementById('hours-closes').value;
        const closed = document.getElementById('hours-closed').checked;
        const orgId = appState.workspaceData?.organization?.id;
        if (!profId || !Number.isInteger(weekday) || weekday < 1 || weekday > 7 || (!closed && (!opensAt || !closesAt))) {
            showAlert('Preencha os dados obrigatórios', 'error'); return;
        }
        const { error } = await appState.supabaseClient.from('professional_hours').upsert([{
            organization_id: orgId, professional_id: profId, weekday,
            opens_at: closed ? null : opensAt, closes_at: closed ? null : closesAt, closed
        }], { onConflict: 'professional_id,weekday' });
        if (error) throw error;
        appState.workspaceData = null; await loadWorkspaceData();
        showAlert('Expediente salvo com sucesso', 'success');
        setTimeout(() => showProfessionalHoursConfig(), 500);
    } catch (error) {
        console.error('Add professional hours error:', error);
        showAlert('Erro ao salvar expediente: ' + error.message, 'error');
    }
}

async function showCommissionRulesConfig() {
    if (appState.userRole !== 'OWNER') { showAlert('Acesso negado', 'error'); return; }
    const configContent = document.getElementById('config-content');
    const orgId = appState.workspaceData?.organization?.id;
    configContent.innerHTML = '<div class="card"><div style="text-align:center;padding:2rem"><div class="loading" style="display:inline-block"></div> Carregando comissões...</div></div>';
    try {
        const [{ data: professionals, error: profError }, { data: rules, error: rulesError }] = await Promise.all([
            appState.supabaseClient.from('professionals').select('id,display_name,active').eq('organization_id', orgId),
            appState.supabaseClient.from('professional_commission_rules').select('professional_id,rate_bps,basis,active').eq('organization_id', orgId)
        ]);
        if (profError) throw profError; if (rulesError) throw rulesError;
        const pMap = Object.fromEntries((professionals || []).map(p => [p.id, p.display_name]));
        configContent.innerHTML = `
            <div class="card"><div class="card-title">Regras de comissão</div>
            <button class="button button-primary" onclick="showAddCommissionRuleForm()" style="margin-bottom:1rem">Adicionar/editar regra</button>
            ${(rules || []).length ? `<table><thead><tr><th>Profissional</th><th>Taxa</th><th>Base</th><th>Ativa</th></tr></thead><tbody>${(rules || []).map(r => `<tr><td>${sanitizeText(pMap[r.professional_id] || '—')}</td><td>${((r.rate_bps || 0)/100).toFixed(2)}%</td><td>${r.basis === 'RECEIVED' ? 'Valor recebido' : 'Total do serviço'}</td><td>${r.active ? 'Sim' : 'Não'}</td></tr>`).join('')}</tbody></table>` : '<p class="text-muted">Nenhuma regra cadastrada</p>'}
            </div>`;
    } catch (error) {
        console.error('Load commission rules config error:', error);
        configContent.innerHTML = `<div class="alert alert-error">Erro ao carregar comissões: ${sanitizeText(error.message)}</div>`;
    }
}

async function showAddCommissionRuleForm() {
    const configContent = document.getElementById('config-content');
    const orgId = appState.workspaceData?.organization?.id;
    configContent.innerHTML = '<div class="card"><div style="text-align:center;padding:2rem"><div class="loading" style="display:inline-block"></div> Carregando...</div></div>';
    try {
        const { data: professionals, error } = await appState.supabaseClient.from('professionals').select('id,display_name,active').eq('organization_id', orgId).eq('active', true).order('display_name');
        if (error) throw error;
        configContent.innerHTML = `
            <div class="card" style="max-width:500px"><div class="card-title">Regra de comissão</div>
            <div class="form-group"><label>Profissional</label><select id="prof-commission-select"><option value="">Selecione</option>${(professionals || []).map(p => `<option value="${p.id}">${sanitizeText(p.display_name)}</option>`).join('')}</select></div>
            <div class="form-group"><label>Taxa (%)</label><input type="number" id="commission-rate" placeholder="10" step="0.01" min="0" max="100"></div>
            <div class="form-group"><label>Base de cálculo</label><select id="commission-basis"><option value="">Selecione</option><option value="RECEIVED">Valor recebido</option><option value="SERVICE_TOTAL">Total do serviço</option></select></div>
            <div class="form-group"><label><input type="checkbox" id="commission-active" checked> Ativa</label></div>
            <div class="button-group"><button class="button button-primary" onclick="submitAddCommissionRule()">Salvar</button><button class="button button-secondary" onclick="showCommissionRulesConfig()">Cancelar</button></div>
            </div>`;
    } catch (error) {
        console.error('Load commission rule form error:', error);
        configContent.innerHTML = `<div class="alert alert-error">Erro ao carregar formulário: ${sanitizeText(error.message)}</div>`;
    }
}

async function submitAddCommissionRule() {
    try {
        const profId = document.getElementById('prof-commission-select').value;
        const ratePercent = parseFloat(document.getElementById('commission-rate').value);
        const basis = document.getElementById('commission-basis').value;
        const active = document.getElementById('commission-active').checked;
        const orgId = appState.workspaceData?.organization?.id;
        if (!profId || isNaN(ratePercent) || ratePercent < 0 || ratePercent > 100 || !basis) {
            showAlert('Preencha todos os dados corretamente', 'error'); return;
        }
        const { error } = await appState.supabaseClient.from('professional_commission_rules').upsert([{
            organization_id: orgId, professional_id: profId, rate_bps: Math.round(ratePercent * 100), basis, active
        }], { onConflict: 'professional_id' });
        if (error) throw error;
        appState.workspaceData = null; await loadWorkspaceData();
        showAlert('Regra de comissão salva com sucesso', 'success');
        setTimeout(() => showCommissionRulesConfig(), 500);
    } catch (error) {
        console.error('Add commission rule error:', error);
        showAlert('Erro ao salvar regra: ' + error.message, 'error');
    }
}

async function showBookingPoliciesConfig() {
    if (appState.userRole !== 'OWNER') { showAlert('Acesso negado', 'error'); return; }
    const configContent = document.getElementById('config-content');
    const orgId = appState.workspaceData?.organization?.id;
    configContent.innerHTML = '<div class="card"><div style="text-align:center;padding:2rem"><div class="loading" style="display:inline-block"></div> Carregando política...</div></div>';
    try {
        const { data: policy, error } = await appState.supabaseClient
            .from('booking_policies')
            .select('public_booking_enabled,allow_public_cancel,allow_public_reschedule,min_notice_minutes,max_advance_days')
            .eq('organization_id', orgId)
            .maybeSingle();
        if (error && error.code !== 'PGRST116') throw error;
        const p = policy || {public_booking_enabled:false,allow_public_cancel:false,allow_public_reschedule:false,min_notice_minutes:0,max_advance_days:90};
        configContent.innerHTML = `
            <div class="card" style="max-width:500px"><div class="card-title">Política de agendamento</div>
            <div class="form-group"><label><input type="checkbox" id="policy-booking-enabled" ${p.public_booking_enabled ? 'checked' : ''}> Habilitar agendamento público</label></div>
            <div class="form-group"><label>Aviso prévio mínimo (minutos)</label><input type="number" id="policy-min-notice" min="0" max="10080" step="1" value="${p.min_notice_minutes ?? 0}"></div>
            <div class="form-group"><label>Dias máximos para agendamento</label><input type="number" id="policy-max-advance" min="1" max="365" step="1" value="${p.max_advance_days ?? 90}"></div>
            <div class="form-group"><label><input type="checkbox" id="policy-allow-cancel" ${p.allow_public_cancel ? 'checked' : ''}> Permitir cancelamento público</label></div>
            <div class="form-group"><label><input type="checkbox" id="policy-allow-reschedule" ${p.allow_public_reschedule ? 'checked' : ''}> Permitir reagendamento público</label></div>
            <div class="button-group"><button class="button button-primary" onclick="submitBookingPolicy()">Salvar</button><button class="button button-secondary" onclick="renderConfigurationPage()">Cancelar</button></div>
            <p class="text-muted" style="margin-top:1rem">O agendamento real só deve ser ativado após cadastrar serviços, profissionais e expediente da unidade.</p>
            </div>`;
    } catch (error) {
        console.error('Load booking policy error:', error);
        configContent.innerHTML = `<div class="alert alert-error">Erro ao carregar política: ${sanitizeText(error.message)}</div>`;
    }
}

async function submitBookingPolicy() {
    try {
        const publicBookingEnabled = document.getElementById('policy-booking-enabled').checked;
        const minNotice = Number(document.getElementById('policy-min-notice').value);
        const maxAdvance = Number(document.getElementById('policy-max-advance').value);
        const allowCancel = document.getElementById('policy-allow-cancel').checked;
        const allowReschedule = document.getElementById('policy-allow-reschedule').checked;
        const orgId = appState.workspaceData?.organization?.id;
        if (!Number.isInteger(minNotice) || minNotice < 0 || minNotice > 10080 || !Number.isInteger(maxAdvance) || maxAdvance < 1 || maxAdvance > 365) {
            showAlert('Revise os limites da política de agendamento', 'error'); return;
        }
        const { error } = await appState.supabaseClient.from('booking_policies').upsert([{
            organization_id: orgId,
            public_booking_enabled: publicBookingEnabled,
            min_notice_minutes: minNotice,
            max_advance_days: maxAdvance,
            allow_public_cancel: allowCancel,
            allow_public_reschedule: allowReschedule
        }], { onConflict: 'organization_id' });
        if (error) throw error;
        showAlert('Política atualizada com sucesso', 'success');
        setTimeout(() => renderConfigurationPage(), 500);
    } catch (error) {
        console.error('Update booking policy error:', error);
        showAlert('Erro ao atualizar política: ' + error.message, 'error');
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
        script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.39.3';
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