let isIntersecting = false;

const __setIntersecting = (value) => {
    isIntersecting = value;
};

const __resetIntersecting = () => {
    isIntersecting = false;
};

const useIntersectionObserver = () => ({
    ref: () => {},
    isIntersecting,
});

module.exports = {
    useIntersectionObserver,
    __setIntersecting,
    __resetIntersecting,
};
