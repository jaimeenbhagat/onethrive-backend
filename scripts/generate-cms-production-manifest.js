/* Read-only local manifest generator. It never imports Supabase or writes production. */
const fs = require('fs');
const path = require('path');
const parser = require('/Users/jaimeenbhagat/Desktop/Jaimeen Bhagat/OneThrive/Frontend/Onethrive-Website/node_modules/@babel/parser');

const root = path.resolve(__dirname, '../../../');
const frontend = path.join(root, 'Frontend/Onethrive-Website');
const sourceRoot = path.join(frontend, 'src');
const outputPath = path.join(__dirname, '..', 'cms-production-import.json');
const records = [];
const seen = new Set();

const sourceRef = (file) => path.relative(root, file).replaceAll(path.sep, '/');
const add = (contentType, slug, payload, sourceFile, displayOrder = 0, enabled = true) => {
  const key = `${contentType}::${slug}`;
  if (seen.has(key)) throw new Error(`Duplicate CMS key: ${key}`);
  seen.add(key);
  const mediaSourceFiles = [];
  const markMedia = (value) => {
    if (typeof value === 'string' && value.startsWith('Frontend/Onethrive-Website/src/assets/')) {
      mediaSourceFiles.push(value);
      return null;
    }
    if (Array.isArray(value)) return value.map(markMedia);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, markMedia(item)]));
    return value;
  };
  const safePayload = markMedia(payload);
  if (mediaSourceFiles.length) safePayload._pendingMediaSourceFiles = [...new Set(mediaSourceFiles)];
  records.push({ content_type: contentType, slug, payload: { ...safePayload, _sourceFile: sourceRef(sourceFile) }, display_order: displayOrder, enabled });
};

const parse = (file) => parser.parse(fs.readFileSync(file, 'utf8'), { sourceType: 'module', plugins: ['jsx'] });
const importsFor = (ast, file) => {
  const values = {};
  for (const node of ast.program.body) {
    if (node.type !== 'ImportDeclaration') continue;
    const local = node.specifiers[0]?.local?.name;
    if (!local) continue;
    const imported = node.source.value;
    values[local] = imported.startsWith('.') ? sourceRef(path.resolve(path.dirname(file), imported)) : imported;
  }
  return values;
};
const evaluate = (node, imports = {}) => {
  if (!node) return undefined;
  switch (node.type) {
    case 'StringLiteral': case 'NumericLiteral': case 'BooleanLiteral': return node.value;
    case 'NullLiteral': return null;
    case 'Identifier': return Object.prototype.hasOwnProperty.call(imports, node.name) ? imports[node.name] : node.name;
    case 'ArrayExpression': return node.elements.map((item) => evaluate(item, imports));
    case 'ObjectExpression': return Object.fromEntries(node.properties.filter((p) => p.type === 'ObjectProperty').map((p) => [p.key.name || p.key.value, evaluate(p.value, imports)]));
    case 'TemplateLiteral': return node.quasis.map((q, i) => q.value.raw + (node.expressions[i] ? String(evaluate(node.expressions[i], imports)) : '')).join('');
    case 'UnaryExpression': return node.operator === '-' ? -evaluate(node.argument, imports) : evaluate(node.argument, imports);
    case 'BinaryExpression': return evaluate(node.left, imports) + evaluate(node.right, imports);
    default: return `[unserializable:${node.type}]`;
  }
};
const declarationValue = (file, name) => {
  const ast = parse(file); const imports = importsFor(ast, file);
  let found;
  const walk = (node) => {
    if (!node || found) return;
    if (node.type === 'VariableDeclaration') {
      const decl = node.declarations.find((d) => d.id?.name === name);
      if (decl) { found = evaluate(decl.init, imports); return; }
    }
    for (const value of Object.values(node)) {
      if (value && typeof value === 'object') Array.isArray(value) ? value.forEach(walk) : walk(value);
    }
  };
  walk(ast.program);
  if (found !== undefined) return found;
  throw new Error(`Could not extract ${name} from ${file}`);
};

const file = (...parts) => path.join(sourceRoot, ...parts);
const homeHero = { heading: 'Build Stronger Teams. Boost Real Engagement.', description: 'We design high-impact employee experiences that spark connection, collaboration, and growth.', ctaText: 'Elevate Your Team Today ->', ctaUrl: '/contact', image: sourceRef(file('assets/herosectionimage1.webp')) };
const homeAbout = { heading: 'Energizing Teams, Elevating Culture', description: 'Break free from one-off events and spark genuine connection. OneThrive partners with HR leaders and directors to craft unforgettable experiences dynamic workshops, immersive offsites, and engaging activities that boost collaboration, lift morale, and energize your workforce.', secondaryDescription: "Ready to build a workplace everyone talks about? Let's get started.", image: sourceRef(file('assets/about.jpeg')) };
add('sections', 'home.hero', homeHero, file('components/Home/HeroSection.jsx'));
add('sections', 'home.about', homeAbout, file('components/Home/AboutUs.jsx'));

const why = declarationValue(file('components/Home/WhyChooseUs.jsx'), 'whyChooseUs');
add('sections', 'home.benefits', { items: why }, file('components/Home/WhyChooseUs.jsx'));
const faqs = declarationValue(file('components/Home/FAQs.jsx'), 'defaultFaqs');
add('sections', 'home.faqs', { items: faqs }, file('components/Home/FAQs.jsx'));
const moments = declarationValue(file('components/Home/MomentsThatMatter.jsx'), 'defaultMoments');
add('carousels', 'home.moments', { title: 'Moments That Matter', description: 'Capturing excellence through unforgettable experiences and transformative events', slides: moments }, file('components/Home/MomentsThatMatter.jsx'));
const testimonials = declarationValue(file('components/Home/Testimonials.jsx'), 'defaultTestimonials');
add('testimonials', 'sheetal-kamat', testimonials[0], file('components/Home/Testimonials.jsx'), 0);
add('testimonials', 'hari-vasudevan', testimonials[1], file('components/Home/Testimonials.jsx'), 1);
add('testimonials', 'naresh-taneja', testimonials[2], file('components/Home/Testimonials.jsx'), 2);
add('testimonials', 'navleen-kour', testimonials[3], file('components/Home/Testimonials.jsx'), 3);
add('testimonials', 'santosh-gopalkrishnan', testimonials[4], file('components/Home/Testimonials.jsx'), 4);
const clients = declarationValue(file('components/Home/ClientLogos.jsx'), 'defaultClientLogos');
clients.forEach((item, index) => add('client-logos', item.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), item, file('components/Home/ClientLogos.jsx'), index));

const aboutHero = { heading: 'About Us', paragraphs: ["It started with a simple realization workplace culture isn't just about deadlines and meetings. It's about people. At OneThrive, we saw employees burning out and teams disconnected, so we built a company dedicated to transforming work into an experience.", 'From team-building challenges to wellness initiatives, we create moments that leave lasting impacts. We partner with organizations to design tailored strategies that boost morale and create truly fulfilling work environments. Because when employees thrive, businesses do too.'], image: sourceRef(file('assets/aboutus.webp')), imageAlt: 'Team collaboration' };
add('sections', 'about.hero', aboutHero, file('components/About/AboutUsHero.jsx'));
add('sections', 'about.mission-vision', { heading: 'Our Purpose', vision: { title: 'Our Vision', body: 'At OneThrive, we elevate workplace culture through tailored experiences that inspire team bonding, ignite creativity, and promote holistic employee well-being. By blending engagement with performance, we help organizations build happier, stronger, and more resilient teams.' }, mission: { title: 'Our Mission', body: 'At OneThrive, we aim to redefine employee engagement by becoming the go-to partner for building vibrant, purpose-driven teams. We envision workplaces as thriving ecosystems of collaboration, creativity, and connection where employees are empowered to grow, perform, and truly belong.' } }, file('components/About/MissionVision.jsx'));
const process = declarationValue(file('components/About/OurProcess.jsx'), 'processSteps');
add('about-process', 'about.process', { heading: 'Our Process', description: 'A step-by-step journey to meaningful, measurable engagement tailored to your team.', steps: process }, file('components/About/OurProcess.jsx'));
const team = declarationValue(file('components/About/OurTeam.jsx'), 'defaultTeam');
team.forEach((member, index) => add('team', member.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), member, file('components/About/OurTeam.jsx'), index));

const servicesData = declarationValue(file('components/Services/serviceData.js'), 'servicesData');
servicesData.serviceCategories.forEach((category, index) => add('service-categories', category.id, category, file('components/Services/serviceData.js'), index));
servicesData.services.forEach((service, index) => add('services', service.id, service, file('components/Services/serviceData.js'), index));
add('sections', 'services.page', { heading: 'Our Services', description: 'Discover our comprehensive range of employee engagement solutions starting from ₹3000 designed to boost morale, enhance collaboration, and create lasting positive impact in your organization.' }, file('pages/Services.jsx'));

add('contact', 'contact.page', { heading: "Let's Connect", description: "We'd love to hear from you! Whether you have questions or need support, feel free to reach out.", phone: '+91 88502 10248', email: 'info@onethrive.in', phoneLabel: 'Phone Number', emailLabel: 'Email Address' }, file('pages/Contact.jsx'));
const navItems = declarationValue(file('components/Navbar.jsx'), 'navItems');
navItems.forEach((item, index) => add('navigation', item.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), { label: item.name, url: item.path, children: item.dropdown || [], visible: true }, file('components/Navbar.jsx'), index));
add('footer', 'site.footer', { phone: '+91 88502 10248', email: 'info@onethrive.in', description: 'We empower organizations to build thriving workplace cultures through engaging team-building experiences, wellness initiatives, and curated employee programs. From fun to functional, our experiences are designed to inspire connection, boost morale, and drive lasting impact.', quickLinks: [{ name: 'Home', path: '/' }, { name: 'About Us', path: '/about' }, { name: 'Services', path: '/services' }, { name: 'Blog', path: '/blogs' }, { name: 'Contact Us', path: '/contact' }], policies: [{ name: 'Privacy Policy', path: '/privacy-policy' }, { name: 'Cancellation & Refund', path: '/cancellation-refund' }, { name: 'Terms & Conditions', path: '/terms-conditions' }], social: { instagram: 'https://www.instagram.com/onethrive.in/', linkedin: 'https://www.linkedin.com/company/onethrive/', youtube: 'https://www.youtube.com/@OneThriveIn' } }, file('components/Footer.jsx'));

const blogDir = file('components/Blog/BlogPosts');
const blogFiles = fs.readdirSync(blogDir).filter((name) => /^BlogPost\d+\.jsx$/.test(name)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
const blogSlugs = ['beyond-the-trust-fall', 'unleashing-innovation', 'measuring-what-matters', 'cultivating-a-thriving-workplace', 'beyond-the-bonus', 'employee-retention-strategies', 'the-founders-guide', 'ceo-playbook', 'fostering-culture'];
blogFiles.forEach((name, index) => {
  const blogFile = path.join(blogDir, name); const data = declarationValue(blogFile, 'blogData');
  add('blogs', blogSlugs[index], { ...data, slug: blogSlugs[index], heroImage: data.heroImage, sourceFile: sourceRef(blogFile) }, blogFile, index);
});

const policyFiles = [['privacy-policy', 'PrivacyPolicy.jsx'], ['terms-conditions', 'TermsConditions.jsx'], ['cancellation-refund', 'CancellationRefundPolicy.jsx']];
policyFiles.forEach(([slug, name]) => {
  const policyFile = file('components/Policies', name);
  add('policies', slug, { title: slug.replaceAll('-', ' '), sourceFile: sourceRef(policyFile), sourceSnapshot: fs.readFileSync(policyFile, 'utf8'), html: '', migrationNote: 'Policy JSX is preserved verbatim in sourceSnapshot; html normalization is required before the CMS-rendered policy path can replace the fallback.' }, policyFile);
});

const roiPage = { title: 'Employee Engagement ROI Calculator', description: "Discover the hidden costs of employee disengagement and unlock your organization's true potential. Our advanced calculator reveals how much money you're losing to turnover, reduced productivity, and absenteeism while showing the incredible ROI of investing in employee engagement." };
add('roi-calculator', 'page', roiPage, file('pages/ROICalculator.jsx'));
add('roi-calculator', 'configuration', { defaults: { employees: 100, annualSalary: 480000, employeesLeft: 10, engagementScore: 6, annualRevenue: 50000000, absenteeismDays: 2 }, benchmarks: { productivityLoss: 0.34, replacementCost: 1.25, workingDays: 250, revenueIncreaseMin: 0.02, revenueIncreaseMax: 0.05 } }, file('components/ROI_Calculator/EngagementROICalculator.jsx'));
add('roi-calculator', 'benchmarks', { title: 'Our Approach & Key Benchmarks', sourceFile: sourceRef(file('components/ROI_Calculator/BenchmarkInfo.jsx')), items: ['Uses your company data for accurate cost estimates.', 'Calculates employee disengagement and turnover costs.', 'Finds clear savings by boosting team engagement.'] }, file('components/ROI_Calculator/BenchmarkInfo.jsx'));
add('pages', 'blogs', { title: 'Blogs', route: '/blogs', status: 'published' }, file('pages/Blog.jsx'));
add('pages', 'roi-calculator', { title: 'Employee Engagement ROI Calculator', route: '/roi-calculator', status: 'published' }, file('pages/ROICalculator.jsx'));
add('pages', 'culture-quiz', { title: 'Culture Quiz', route: '/culture-quiz', status: 'published' }, file('pages/CultureQuiz.jsx'));
add('resources', 'blogs', { title: 'Blogs', route: '/blogs', description: 'OneThrive workplace culture and engagement resources.' }, file('pages/Blog.jsx'));
add('resources', 'roi-calculator', { title: 'ROI Calculator', route: '/roi-calculator', description: roiPage.description }, file('pages/ROICalculator.jsx'));
add('resources', 'culture-quiz', { title: 'Culture Quiz', route: '/culture-quiz', description: 'Assess your workplace culture.' }, file('pages/CultureQuiz.jsx'));

const quizData = declarationValue(file('components/CultureQuiz/quizData.js'), 'quizData');
add('quiz', 'culture-pulse', { title: 'Culture Pulse', intro: 'Assess your workplace culture through seven engagement questions.', questions: quizData, maxScore: quizData.reduce((sum, question) => sum + Math.max(...question.options.map((option) => option.score)), 0) }, file('components/CultureQuiz/quizData.js'));
add('quiz-results', 'culture-pulse', { bands: [{ minScore: 81, maxScore: 98, level: 'The Culture Innovator' }, { minScore: 61, maxScore: 80, level: 'The Emerging Leader' }, { minScore: 41, maxScore: 60, level: 'The Developing Force' }, { minScore: 21, maxScore: 40, level: 'The Culture Challenge' }, { minScore: 0, maxScore: 20, level: 'The Culture Crisis' }], sourceFile: sourceRef(file('components/CultureQuiz/getCultureLevel.jsx')), sourceSnapshot: fs.readFileSync(file('components/CultureQuiz/getCultureLevel.jsx'), 'utf8') }, file('components/CultureQuiz/getCultureLevel.jsx'));

add('seo', 'home', { title: 'OneThrive - Employee Engagement & Team Building', description: 'OneThrive brings workplaces to life through employee engagement, team-building experiences, and corporate wellness programs that uplift morale and fuel innovation.' }, file('pages/Home.jsx'));
add('seo', 'about', { title: 'About Us - OneThrive', description: "Learn more about OneThrive's mission, vision, and team. We specialize in employee engagement, team-building experiences, and corporate wellness programs." }, file('pages/About.jsx'));
add('seo', 'services', { title: 'Our Services | OneThrive Employee Engagement Solutions', description: "Explore OneThrive's comprehensive range of employee engagement services designed to boost morale, enhance collaboration, and create lasting positive impact in your organization." }, file('pages/Services.jsx'));

const manifest = { manifest_version: 2, generated_at: new Date().toISOString(), source: 'local OneThrive frontend source files', scope: 'public.cms_content', conflict_key: ['content_type', 'slug'], records: records.length, groups: [...new Set(records.map((record) => record.content_type))].map((content_type) => ({ content_type, records: records.filter((record) => record.content_type === content_type) })) };
fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Generated ${records.length} records across ${manifest.groups.length} content types at ${outputPath}`);
