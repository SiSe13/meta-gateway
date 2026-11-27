/** 使用产品提供的 MetaAPI 品牌图标，统一顶栏、登录页和浏览器标签页的标识。 */
export function BrandMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <img
      className={className}
      width={size}
      height={size}
      src={`${import.meta.env.BASE_URL}favicon.ico`}
      alt="Balbo AI"
      decoding="async"
      draggable={false}
    />
  );
}

export default BrandMark;
