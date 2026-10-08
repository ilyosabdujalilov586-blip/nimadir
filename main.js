// Scroll to Top logikasi
(function () {
  const scrollToTopBtn = document.getElementById('scrollToTopBtn');
  if (!scrollToTopBtn) return;

  window.addEventListener('scroll', () => {
    if (window.scrollY > 300) {
      scrollToTopBtn.classList.remove('d-none');
      scrollToTopBtn.classList.add('d-flex');
    } else {
      scrollToTopBtn.classList.remove('d-flex');
      scrollToTopBtn.classList.add('d-none');
    }
  });

  scrollToTopBtn.addEventListener('click', () => {
    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  });
})();