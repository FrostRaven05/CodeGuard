const views = {
  workbench: {
    title: '改动与差异',
    alt: 'CodeGuard 改动与差异界面：左侧文件树、中间源码差异、右侧提交与评审面板',
    description: '未暂存、已暂存、未跟踪，各归其位。阅读真实差异，只提交你选定的内容。',
  },
  'review-flow': {
    title: '改动图解',
    alt: 'CodeGuard 改动图解界面：固定版本的解释流程、代码依据与评审状态',
    description: '从行为前后对比到影响流程，连接代码依据。AI 提供解释与建议，判断仍然在你。',
  },
  history: {
    title: '提交历史',
    alt: 'CodeGuard 提交历史界面：彩色分支图、提交记录与所选提交详情',
    description: '沿着彩色分支图回看提交，按说明、作者或哈希搜索，打开某次提交的真实差异。',
  },
  branches: {
    title: '分支管理',
    alt: 'CodeGuard 分支管理界面：本地与远端分组，分支搜索、新建和检出入口',
    description: '本地与远端分组查看，搜索、新建与检出。切换和合并之前，先核对来源与目标。',
  },
};
const tabs = [...document.querySelectorAll('[role="tab"]')];
const screenshot = document.querySelector('#product-screenshot');
const panel = document.querySelector('#preview-panel');
const screenshotButton = document.querySelector('.screenshot-button');
let currentView = 'workbench';

function selectView(tab, focus = false) {
  currentView = tab.dataset.view;
  const view = views[currentView];
  for (const item of tabs) {
    const selected = item === tab;
    item.setAttribute('aria-selected', String(selected));
    item.tabIndex = selected ? 0 : -1;
  }
  screenshot.src = `assets/${currentView}.png`;
  screenshot.alt = view.alt;
  screenshotButton.setAttribute('aria-label', `放大${view.title}截图`);
  panel.setAttribute('aria-labelledby', tab.id);
  document.querySelector('#preview-description').textContent = view.description;
  document.querySelector('#preview-counter').textContent = `0${tabs.indexOf(tab) + 1} / 04`;
  if (focus) tab.focus();
}
for (const tab of tabs) {
  tab.addEventListener('click', () => selectView(tab));
  tab.addEventListener('keydown', (event) => {
    let index = tabs.indexOf(tab);
    if (event.key === 'ArrowRight') index = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') index = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = tabs.length - 1;
    else return;
    event.preventDefault();
    selectView(tabs[index], true);
  });
}

const dialog = document.querySelector('.image-dialog');
let dialogTrigger;
function openPreview(event) {
  dialogTrigger = event.currentTarget;
  const view = views[currentView];
  document.querySelector('#dialog-title').textContent = view.title;
  const image = document.querySelector('#dialog-image');
  image.src = screenshot.src;
  image.alt = view.alt;
  dialog.showModal();
  dialog.scrollTo(0, 0);
  document.body.classList.add('dialog-open');
}
document.querySelector('.expand-preview').addEventListener('click', openPreview);
screenshotButton.addEventListener('click', openPreview);
document.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (event) => {
  if (event.target !== dialog) return;
  const bounds = dialog.getBoundingClientRect();
  if (
    event.clientX < bounds.left ||
    event.clientX > bounds.right ||
    event.clientY < bounds.top ||
    event.clientY > bounds.bottom
  )
    dialog.close();
});
dialog.addEventListener('close', () => {
  document.body.classList.remove('dialog-open');
  dialogTrigger?.focus({ preventScroll: true });
});

const menuToggle = document.querySelector('.menu-toggle');
const navigation = document.querySelector('#navigation');
function closeMenu() {
  navigation.classList.remove('is-open');
  menuToggle.setAttribute('aria-expanded', 'false');
  menuToggle.setAttribute('aria-label', '打开导航');
}
menuToggle.addEventListener('click', () => {
  const isOpen = navigation.classList.toggle('is-open');
  menuToggle.setAttribute('aria-expanded', String(isOpen));
  menuToggle.setAttribute('aria-label', isOpen ? '关闭导航' : '打开导航');
});
for (const link of navigation.querySelectorAll('a')) link.addEventListener('click', closeMenu);
document.addEventListener('click', (event) => {
  if (!navigation.contains(event.target) && !menuToggle.contains(event.target)) closeMenu();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && navigation.classList.contains('is-open')) {
    closeMenu();
    menuToggle.focus();
  }
});
matchMedia('(min-width: 621px)').addEventListener('change', (event) => {
  if (event.matches) closeMenu();
});
